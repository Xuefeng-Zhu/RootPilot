import { parseDuration } from './time.js';
import { SERVICE_TOPOLOGY } from './topology.js';
import type { ScenarioName, SimulatorConfig } from './types.js';

const VALID_SCENARIOS = new Set<ScenarioName>([
  'normal',
  'checkout-error',
  'bad-deploy',
  'database-degradation',
  'cache-miss-storm',
  'high-cardinality',
  'multi-service',
  'multi-tenant',
]);

export function parseArgs(argv: string[]): SimulatorConfig {
  const values = new Map<string, string | boolean>();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument "${arg}". Use --flag value syntax.`);
    }

    const key = arg.slice(2);
    if (key === 'verbose' || key === 'dry-run' || key === 'once') {
      values.set(key, true);
      continue;
    }

    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    values.set(key, next);
    i += 1;
  }

  const scenario = String(values.get('scenario') ?? 'normal') as ScenarioName;
  if (!VALID_SCENARIOS.has(scenario)) {
    throw new Error(
      `Invalid scenario "${scenario}". Valid scenarios: ${[...VALID_SCENARIOS].join(', ')}`,
    );
  }

  const servicesValue = values.get('services');
  const services =
    typeof servicesValue === 'string' && servicesValue.trim() !== ''
      ? servicesValue
          .split(',')
          .map((service) => service.trim())
          .filter(Boolean)
      : undefined;

  if (services) {
    const invalidServices = services.filter(
      (service) => !SERVICE_TOPOLOGY.includes(service as never),
    );
    if (invalidServices.length > 0) {
      throw new Error(
        `Unknown services: ${invalidServices.join(', ')}. Valid services: ${SERVICE_TOPOLOGY.join(', ')}`,
      );
    }
  }

  const rate = Number(values.get('rate') ?? 20);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('--rate must be a positive number');
  }

  const seedValue = values.get('seed');
  const seed = seedValue === undefined ? undefined : Number(seedValue);
  if (seed !== undefined && (!Number.isInteger(seed) || seed < 0)) {
    throw new Error('--seed must be a non-negative integer');
  }

  const secondaryApiKey = values.get('secondary-api-key');

  return {
    baseUrl: String(values.get('base-url') ?? 'http://localhost:4000').replace(/\/$/, ''),
    apiKey: String(values.get('api-key') ?? 'rootpilot_demo_key'),
    secondaryApiKey: typeof secondaryApiKey === 'string' ? secondaryApiKey : undefined,
    tenant: String(values.get('tenant') ?? 'demo'),
    project: String(values.get('project') ?? 'default'),
    environment: String(values.get('environment') ?? 'production'),
    scenario,
    durationMs: parseDuration(String(values.get('duration') ?? '5m')),
    rate,
    services,
    seed,
    verbose: values.get('verbose') === true,
    dryRun: values.get('dry-run') === true,
    once: values.get('once') === true,
  };
}

export function printUsage(): void {
  console.log(`RootPilot telemetry simulator

Usage:
  npm run simulate -- [options]

Examples:
  npm run simulate
  npm run simulate -- --scenario normal --duration 5m --rate 20
  npm run simulate -- --scenario checkout-error --duration 10m --rate 50
  npm run simulate -- --scenario bad-deploy --duration 10m --rate 30
  npm run simulate -- --scenario high-cardinality --duration 3m --rate 100
  npm run simulate -- --scenario multi-service --duration 15m --rate 40
  npm run simulate -- --once

Options:
  --base-url http://localhost:4000
  --api-key rootpilot_demo_key
  --secondary-api-key <key>       Used by multi-tenant scenario
  --tenant demo
  --project default
  --environment production
  --scenario normal
  --duration 5m
  --rate 20
  --services api-gateway,checkout-service
  --seed 123
  --verbose
  --dry-run
  --once`);
}
