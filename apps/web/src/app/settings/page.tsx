'use client';

import { useState } from 'react';

const API_KEY = 'rootpilot_demo_key';
const API_KEY_PREFIX = API_KEY.slice(0, 8);
const MASKED_KEY = `${API_KEY_PREFIX}${'•'.repeat(API_KEY.length - 8)}`;

const curlCommands = [
  {
    title: 'Log Ingestion',
    description: 'Send application logs in OTLP JSON format',
    command: `curl -X POST http://localhost:4000/v1/ingest/logs \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${API_KEY}" \\
  -d '{
    "resourceLogs": [{
      "resource": {
        "attributes": [
          {"key": "service.name", "value": {"stringValue": "my-service"}},
          {"key": "deployment.environment", "value": {"stringValue": "production"}}
        ]
      },
      "scopeLogs": [{
        "logRecords": [{
          "timeUnixNano": "1700000000000000000",
          "severityNumber": 9,
          "body": {"stringValue": "User login successful"}
        }]
      }]
    }]
  }'`,
  },
  {
    title: 'Trace Ingestion',
    description: 'Send distributed traces in OTLP JSON format',
    command: `curl -X POST http://localhost:4000/v1/ingest/traces \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${API_KEY}" \\
  -d '{
    "resourceSpans": [{
      "resource": {
        "attributes": [
          {"key": "service.name", "value": {"stringValue": "my-service"}},
          {"key": "deployment.environment", "value": {"stringValue": "production"}}
        ]
      },
      "scopeSpans": [{
        "spans": [{
          "traceId": "abc123def456abc123def456abc123de",
          "spanId": "1234567890abcdef",
          "name": "GET /api/users",
          "startTimeUnixNano": "1700000000000000000",
          "endTimeUnixNano": "1700000000150000000",
          "kind": 2,
          "status": {"code": 1}
        }]
      }]
    }]
  }'`,
  },
  {
    title: 'Metric Ingestion',
    description: 'Send application metrics in OTLP JSON format',
    command: `curl -X POST http://localhost:4000/v1/ingest/metrics \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${API_KEY}" \\
  -d '{
    "resourceMetrics": [{
      "resource": {
        "attributes": [
          {"key": "service.name", "value": {"stringValue": "my-service"}},
          {"key": "deployment.environment", "value": {"stringValue": "production"}}
        ]
      },
      "scopeMetrics": [{
        "metrics": [{
          "name": "http.request.duration",
          "unit": "ms",
          "gauge": {
            "dataPoints": [{
              "timeUnixNano": "1700000000000000000",
              "asDouble": 42.5,
              "attributes": [
                {"key": "http.method", "value": {"stringValue": "GET"}}
              ]
            }]
          }
        }]
      }]
    }]
  }'`,
  },
  {
    title: 'Deployment Event',
    description: 'Record a deployment event in RootPilot custom JSON format',
    command: `curl -X POST http://localhost:4000/v1/events/deployments \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${API_KEY}" \\
  -d '{
    "service_name": "my-service",
    "environment": "production",
    "version": "1.2.0",
    "git_sha": "a1b2c3d4e5f6",
    "deployed_by": "ci-pipeline",
    "provider": "github-actions"
  }'`,
  },
];

const simulatorCommands = [
  {
    title: 'Normal Traffic',
    command: 'npm run simulate -- --scenario normal --duration 5m --rate 20',
    inspect: 'Overview, Logs, Traces, Metrics, Services',
  },
  {
    title: 'Bad Deploy',
    command: 'npm run simulate:bad-deploy -- --duration 10m --rate 30',
    inspect: 'Deployments, Service Map, Error Groups, Service Detail',
  },
  {
    title: 'Refresh correlations',
    command: 'npm run correlations:refresh -- --from now-2h --to now',
    inspect: 'Service Map, Services, Error Groups, Deployments',
  },
  {
    title: 'Graph Traffic',
    command: 'npm run simulate:graph',
    inspect: 'Service Map and dependency detail',
  },
  {
    title: 'Checkout Errors',
    command: 'npm run simulate:checkout-error -- --duration 10m --rate 50',
    inspect: 'Logs, Traces, Metrics',
  },
  {
    title: 'Dry Run',
    command: 'npm run simulate:dry-run',
    inspect: 'Terminal payload output',
  },
];

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for environments without clipboard API
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded
                 bg-surface-card border border-surface-border text-gray-300
                 hover:bg-sidebar-hover hover:text-white transition-colors"
      aria-label={label ?? 'Copy to clipboard'}
    >
      {copied ? (
        <>
          <CheckIcon className="w-3.5 h-3.5 text-green-400" />
          <span className="text-green-400">Copied</span>
        </>
      ) : (
        <>
          <ClipboardIcon className="w-3.5 h-3.5" />
          <span>Copy</span>
        </>
      )}
    </button>
  );
}

export default function SettingsPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-white mb-6">Settings</h1>

      {/* API Key Section */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-white mb-3">API Key</h2>
        <div className="bg-surface-card border border-surface-border rounded-lg p-4">
          <p className="text-sm text-gray-400 mb-3">
            Use this API key to authenticate requests to the RootPilot ingestion and query APIs.
          </p>
          <div className="flex items-center gap-3">
            <code className="flex-1 px-3 py-2 bg-surface border border-surface-border rounded text-sm text-gray-300 font-mono">
              {MASKED_KEY}
            </code>
            <CopyButton text={API_KEY} label="Copy full API key" />
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Showing prefix only. Click copy to get the full key.
          </p>
        </div>
      </section>

      {/* Telemetry Simulator Section */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-white mb-3">Telemetry Simulator</h2>
        <p className="text-sm text-gray-400 mb-4">
          Generate realistic local telemetry for dashboards, explorers, service discovery, service
          graph, error groups, and deployment timelines.
        </p>
        <div className="grid gap-3">
          {simulatorCommands.map((item) => (
            <div
              key={item.title}
              className="bg-surface-card border border-surface-border rounded-lg p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-medium text-white">{item.title}</h3>
                  <p className="text-xs text-gray-500 mt-1">Inspect: {item.inspect}</p>
                </div>
                <CopyButton text={item.command} label={`Copy ${item.title} simulator command`} />
              </div>
              <pre className="mt-3 px-3 py-2 text-xs text-gray-300 font-mono bg-surface border border-surface-border rounded overflow-x-auto whitespace-pre">
                {item.command}
              </pre>
            </div>
          ))}
        </div>
      </section>

      {/* Curl Commands Section */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-3">Quick Start Commands</h2>
        <p className="text-sm text-gray-400 mb-4">
          Copy-pasteable curl commands to send telemetry data to your local RootPilot instance at
          localhost:4000.
        </p>

        <div className="space-y-6">
          {curlCommands.map((item) => (
            <div
              key={item.title}
              className="bg-surface-card border border-surface-border rounded-lg overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border">
                <div>
                  <h3 className="text-sm font-medium text-white">{item.title}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>
                </div>
                <CopyButton text={item.command} label={`Copy ${item.title} command`} />
              </div>
              <pre className="px-4 py-3 text-xs text-gray-300 font-mono overflow-x-auto whitespace-pre">
                {item.command}
              </pre>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ClipboardIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184"
      />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}
