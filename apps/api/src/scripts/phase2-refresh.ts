import {
  buildDeploymentImpacts,
  buildErrorGroups,
  buildServiceDependencies,
  buildServiceSummaries,
  refreshPhase2,
} from '../phase2/builders.js';
import { parseScriptArgs, scriptTimeRange } from '../phase2/time.js';
import { close as closePostgres } from '../db/postgres.js';
import { closeClickHouseClient } from '../db/clickhouse.js';

type RefreshMode = 'graph' | 'error-groups' | 'deployments' | 'all';

function modeFromArgs(value: string | boolean | undefined): RefreshMode {
  if (value === 'graph' || value === 'error-groups' || value === 'deployments' || value === 'all') {
    return value;
  }
  return 'all';
}

async function main(): Promise<void> {
  const args = parseScriptArgs(process.argv.slice(2));
  const mode = modeFromArgs(args.mode);
  const range = scriptTimeRange(args);
  const tenantId = typeof args['tenant-id'] === 'string' ? args['tenant-id'] : undefined;
  const projectId = typeof args['project-id'] === 'string' ? args['project-id'] : undefined;
  const environment = typeof args.environment === 'string' ? args.environment : undefined;

  console.log(`[phase2:refresh] Mode: ${mode}`);
  console.log(`[phase2:refresh] Window: ${range.from.toISOString()} -> ${range.to.toISOString()}`);
  if (environment) console.log(`[phase2:refresh] Environment: ${environment}`);

  const options = { range, tenantId, projectId, environment };

  if (mode === 'graph') {
    const serviceSummaries = await buildServiceSummaries(options);
    const serviceDependencies = await buildServiceDependencies(options);
    console.log(
      `[phase2:refresh] Built ${serviceSummaries} service summaries and ${serviceDependencies} dependency edges.`,
    );
    return;
  }

  if (mode === 'error-groups') {
    const errorGroups = await buildErrorGroups(options);
    console.log(`[phase2:refresh] Built ${errorGroups} error groups.`);
    return;
  }

  if (mode === 'deployments') {
    const deploymentImpacts = await buildDeploymentImpacts(options);
    console.log(`[phase2:refresh] Built ${deploymentImpacts} deployment impacts.`);
    return;
  }

  const result = await refreshPhase2(options);
  console.log(
    [
      '[phase2:refresh] Complete:',
      `${result.serviceSummaries} service summaries`,
      `${result.serviceDependencies} dependency edges`,
      `${result.errorGroups} error groups`,
      `${result.deploymentImpacts} deployment impacts`,
    ].join(' '),
  );
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[phase2:refresh] ERROR: ${message}`);
    process.exit(1);
  })
  .finally(async () => {
    await closeClickHouseClient();
    await closePostgres();
  });
