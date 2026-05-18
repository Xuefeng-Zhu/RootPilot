#!/usr/bin/env node
import { parseArgs, printUsage } from './config.js';
import { runSimulator } from './runner.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  try {
    const config = parseArgs(args);
    await runSimulator(config);
  } catch (error) {
    console.error(`[simulator] ERROR: ${error instanceof Error ? error.message : String(error)}`);
    console.error('[simulator] Run npm run simulate -- --help for usage.');
    process.exitCode = 1;
  }
}

void main();
