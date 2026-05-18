import { SimulatorApiClient, sendTelemetryBatch } from './client.js';
import { buildDryRunPayload } from './payloads.js';
import { formatDuration, sleep } from './time.js';
import { TelemetryGenerator } from './generator.js';
import type { SimulationSummary, SimulatorConfig, TelemetryBatch } from './types.js';

interface SimulationStream {
  label: string;
  config: SimulatorConfig;
  generator: TelemetryGenerator;
  client: SimulatorApiClient;
}

export async function runSimulator(config: SimulatorConfig): Promise<SimulationSummary> {
  const streams = createStreams(config);
  const summary: SimulationSummary = {
    logsSent: 0,
    spansSent: 0,
    metricsSent: 0,
    deploymentEventsSent: 0,
    servicesGenerated: new Set<string>(),
    errorsGenerated: 0,
    failedHttpRequests: 0,
    scenario: config.scenario,
    durationMs: config.once ? 0 : config.durationMs,
  };

  printStart(config);

  if (config.scenario === 'multi-tenant' && !config.secondaryApiKey) {
    console.log(
      '[simulator] multi-tenant scenario needs --secondary-api-key to send second-tenant data.',
    );
    console.log(
      '[simulator] Add a second tenant/key in Postgres, then rerun with --secondary-api-key <key>. Continuing with demo tenant only.',
    );
  } else if (streams.length > 1) {
    console.log(
      `[simulator] multi-tenant scenario sending ${streams.length} tenant streams: ${streams.map((stream) => stream.config.tenant).join(', ')}`,
    );
  }

  if (config.once) {
    const requestCount = Math.max(
      4,
      Math.min(8, Math.round(config.rate / Math.max(1, streams.length))),
    );
    for (const stream of streams) {
      const batch = stream.generator.generateBatch({ timestamp: new Date(), requestCount });
      await handleBatch(stream, batch, summary);
    }
    printSummary(summary);
    return summary;
  }

  const startedAt = Date.now();
  let lastProgressAt = startedAt;
  let tick = 0;
  while (Date.now() - startedAt < config.durationMs) {
    const requestCount = Math.max(1, Math.round(config.rate / Math.max(1, streams.length)));
    for (const stream of streams) {
      const batch = stream.generator.generateBatch({ timestamp: new Date(), requestCount });
      await handleBatch(stream, batch, summary);
    }

    const now = Date.now();
    if (now - lastProgressAt >= 5000) {
      printProgress(summary, now - startedAt);
      lastProgressAt = now;
    }

    tick += 1;
    const nextTickAt = startedAt + tick * 1000;
    await sleep(Math.max(0, nextTickAt - Date.now()));
  }

  printSummary(summary);
  return summary;
}

function createStreams(config: SimulatorConfig): SimulationStream[] {
  const primary: SimulationStream = {
    label: config.tenant,
    config,
    generator: new TelemetryGenerator(config),
    client: new SimulatorApiClient(config.baseUrl, config.apiKey),
  };

  if (config.scenario !== 'multi-tenant' || !config.secondaryApiKey) {
    return [primary];
  }

  const secondaryConfig: SimulatorConfig = {
    ...config,
    apiKey: config.secondaryApiKey,
    secondaryApiKey: undefined,
    tenant: `${config.tenant}-secondary`,
    seed: config.seed === undefined ? undefined : config.seed + 1,
  };

  return [
    primary,
    {
      label: secondaryConfig.tenant,
      config: secondaryConfig,
      generator: new TelemetryGenerator(secondaryConfig),
      client: new SimulatorApiClient(secondaryConfig.baseUrl, secondaryConfig.apiKey),
    },
  ];
}

async function handleBatch(
  stream: SimulationStream,
  batch: TelemetryBatch,
  summary: SimulationSummary,
): Promise<void> {
  const { config, client, label } = stream;

  for (const span of batch.spans) {
    summary.servicesGenerated.add(span.serviceName);
  }
  for (const log of batch.logs) {
    summary.servicesGenerated.add(log.serviceName);
    if (log.severity === 'ERROR' || log.severity === 'FATAL') {
      summary.errorsGenerated += 1;
    }
  }
  for (const metric of batch.metrics) {
    summary.servicesGenerated.add(metric.serviceName);
  }
  for (const deployment of batch.deploymentEvents) {
    summary.servicesGenerated.add(deployment.service_name);
  }

  if (config.verbose || config.dryRun) {
    printBatch(config, batch, label);
  }

  const result = await sendTelemetryBatch(config, batch, client);
  summary.logsSent += result.logsSent;
  summary.spansSent += result.spansSent;
  summary.metricsSent += result.metricsSent;
  summary.deploymentEventsSent += result.deploymentEventsSent;
  summary.failedHttpRequests += result.failedHttpRequests;
}

function printStart(config: SimulatorConfig): void {
  console.log(`[simulator] RootPilot telemetry simulator`);
  console.log(
    `[simulator] scenario=${config.scenario} baseUrl=${config.baseUrl} environment=${config.environment}`,
  );
  console.log(
    `[simulator] rate=${config.rate}/s duration=${config.once ? 'once' : formatDuration(config.durationMs)} dryRun=${config.dryRun}`,
  );
  if (config.scenario === 'high-cardinality') {
    console.log(
      '[simulator] high-cardinality is intentionally noisy: user_id, session_id, and request_id labels are generated.',
    );
  }
}

function printBatch(config: SimulatorConfig, batch: TelemetryBatch, label: string): void {
  console.log(
    `[simulator] batch tenant=${label} logs=${batch.logs.length} spans=${batch.spans.length} metrics=${batch.metrics.length} deployments=${batch.deploymentEvents.length}`,
  );
  if (config.dryRun) {
    console.log(JSON.stringify(buildDryRunPayload(batch), null, 2));
  }
}

function printProgress(summary: SimulationSummary, elapsedMs: number): void {
  console.log(
    `[simulator] progress elapsed=${formatDuration(elapsedMs)} logs=${summary.logsSent} spans=${summary.spansSent} metrics=${summary.metricsSent} deployments=${summary.deploymentEventsSent} failedRequests=${summary.failedHttpRequests}`,
  );
}

export function printSummary(summary: SimulationSummary): void {
  console.log('[simulator] Final summary');
  console.log(`  scenario: ${summary.scenario}`);
  console.log(`  duration: ${formatDuration(summary.durationMs)}`);
  console.log(`  logs sent: ${summary.logsSent}`);
  console.log(`  spans sent: ${summary.spansSent}`);
  console.log(`  metrics sent: ${summary.metricsSent}`);
  console.log(`  deployment events sent: ${summary.deploymentEventsSent}`);
  console.log(
    `  services generated: ${[...summary.servicesGenerated].sort().join(', ') || 'none'}`,
  );
  console.log(`  errors generated: ${summary.errorsGenerated}`);
  console.log(`  failed HTTP requests: ${summary.failedHttpRequests}`);
}
