import type {
  DeploymentEventRequest,
  LogSeverity,
  SpanKind,
  SpanStatusCode,
} from '@rootpilot/shared';
import { SeededRandom } from './rng.js';
import { DEFAULT_VERSION_BY_SERVICE, SERVICE_TOPOLOGY, type ServiceName } from './topology.js';
import type {
  GenerateBatchOptions,
  LogTelemetry,
  MetricTelemetry,
  SimulatorConfig,
  SpanTelemetry,
  TelemetryBatch,
} from './types.js';

interface RequestPattern {
  method: string;
  route: string;
  kind: 'checkout' | 'products' | 'search' | 'recommendations';
}

interface SpanStep {
  id: string;
  parentId: string;
  serviceName: ServiceName;
  operationName: string;
  kind: SpanKind;
  offsetMs: number;
  durationMs: number;
  statusCode: SpanStatusCode;
  statusMessage: string;
  attributes: Record<string, string | number | boolean>;
}

const REQUEST_PATTERNS: RequestPattern[] = [
  { method: 'GET', route: '/api/products', kind: 'products' },
  { method: 'POST', route: '/api/checkout', kind: 'checkout' },
  { method: 'GET', route: '/api/search', kind: 'search' },
  { method: 'GET', route: '/api/recommendations', kind: 'recommendations' },
];

const ERROR_MESSAGE = 'PaymentProviderTimeout: timeout exceeded after 500ms';

export class TelemetryGenerator {
  private readonly rng: SeededRandom;
  private deploymentEmitted = false;
  private sequence = 0;

  constructor(private readonly config: SimulatorConfig) {
    this.rng = new SeededRandom(config.seed ?? Date.now());
  }

  generateBatch(options: GenerateBatchOptions): TelemetryBatch {
    const batch: TelemetryBatch = {
      logs: [],
      spans: [],
      metrics: [],
      deploymentEvents: [],
    };

    if (this.shouldEmitDeployment()) {
      batch.deploymentEvents.push(this.createDeployment(options.timestamp));
      this.deploymentEmitted = true;
    }

    for (let i = 0; i < options.requestCount; i += 1) {
      this.sequence += 1;
      const timestamp = new Date(options.timestamp.getTime() + i * 10);
      const unit = this.generateRequest(timestamp);
      batch.logs.push(...unit.logs);
      batch.spans.push(...unit.spans);
      batch.metrics.push(...unit.metrics);
    }

    batch.metrics.push(...this.heartbeatMetrics(options.timestamp));

    return batch;
  }

  private shouldEmitDeployment(): boolean {
    if (this.config.scenario === 'bad-deploy' && !this.deploymentEmitted) return true;
    if (this.config.once || this.deploymentEmitted) return false;
    if (this.config.scenario === 'normal' || this.config.scenario === 'multi-service') {
      return this.rng.bool(0.03);
    }
    return false;
  }

  private createDeployment(timestamp: Date): DeploymentEventRequest {
    const service =
      this.config.scenario === 'bad-deploy' ? 'checkout-service' : this.rng.pick(SERVICE_TOPOLOGY);
    const version =
      service === 'checkout-service' ? 'v1.4.2' : bumpPatch(DEFAULT_VERSION_BY_SERVICE[service]);

    return {
      deployment_id: randomUuid(this.rng),
      service_name: service,
      environment: this.config.environment,
      version,
      git_sha: this.rng.hex(10),
      deployed_by: 'simulator',
      provider: 'github-actions',
      timestamp: timestamp.toISOString(),
      metadata: {
        branch: 'main',
        scenario: this.config.scenario,
        commit_message:
          this.config.scenario === 'bad-deploy'
            ? 'Reduce payment provider timeout'
            : `Simulator deploy for ${service}`,
      },
    };
  }

  private generateRequest(timestamp: Date): TelemetryBatch {
    const pattern = this.choosePattern();
    const traceId = this.rng.hex(16);
    const rootSpanId = this.rng.hex(8);
    const context = this.scenarioContext(pattern);
    const steps = this.createSpanSteps(pattern, rootSpanId, context);
    const rootDuration =
      Math.max(...steps.map((step) => step.offsetMs + step.durationMs)) + this.rng.int(4, 20);
    const rootStatus = steps.some((step) => step.statusCode === 'ERROR') ? 'ERROR' : 'OK';
    const rootSpan: SpanStep = {
      id: rootSpanId,
      parentId: '',
      serviceName: 'api-gateway',
      operationName: `${pattern.method} ${pattern.route}`,
      kind: 'SERVER',
      offsetMs: 0,
      durationMs: rootDuration,
      statusCode: rootStatus,
      statusMessage: rootStatus === 'ERROR' ? context.errorMessage : '',
      attributes: {
        'http.method': pattern.method,
        'http.route': pattern.route,
        'http.status_code': rootStatus === 'ERROR' ? 500 : 200,
        scenario: this.config.scenario,
      },
    };
    const allSteps = [rootSpan, ...steps];

    const spans = allSteps.map((step) => this.toSpan(traceId, timestamp, step));
    const logs = allSteps.flatMap((step) => this.logsForSpan(traceId, timestamp, step, context));
    const metrics = this.metricsForRequest(timestamp, pattern, allSteps, context);

    return { logs, spans, metrics, deploymentEvents: [] };
  }

  private choosePattern(): RequestPattern {
    if (this.config.services && this.config.services.length > 0) {
      if (
        this.config.services.some((service) =>
          ['checkout-service', 'payment-service', 'order-service'].includes(service),
        )
      ) {
        return REQUEST_PATTERNS[1]!;
      }
      if (this.config.services.includes('search-service')) {
        return REQUEST_PATTERNS[2]!;
      }
      if (this.config.services.includes('recommendation-service')) {
        return REQUEST_PATTERNS[3]!;
      }
      if (this.config.services.includes('inventory-service')) {
        return REQUEST_PATTERNS[0]!;
      }
    }

    switch (this.config.scenario) {
      case 'checkout-error':
      case 'bad-deploy':
      case 'database-degradation':
        return REQUEST_PATTERNS[1]!;
      case 'cache-miss-storm':
        return this.rng.bool(0.5) ? REQUEST_PATTERNS[2]! : REQUEST_PATTERNS[3]!;
      case 'multi-service':
        return this.rng.pick(REQUEST_PATTERNS);
      default:
        return this.rng.pick(REQUEST_PATTERNS);
    }
  }

  private scenarioContext(pattern: RequestPattern): {
    isError: boolean;
    isWarning: boolean;
    errorMessage: string;
    highCardinality: boolean;
  } {
    const checkoutProblem =
      pattern.kind === 'checkout' &&
      (this.config.scenario === 'checkout-error' || this.config.scenario === 'bad-deploy');
    const dbProblem =
      pattern.kind === 'checkout' && this.config.scenario === 'database-degradation';
    const cacheProblem =
      (pattern.kind === 'search' || pattern.kind === 'recommendations') &&
      this.config.scenario === 'cache-miss-storm';
    const normalError = this.rng.bool(this.config.scenario === 'normal' ? 0.02 : 0.04);

    return {
      isError: checkoutProblem || normalError,
      isWarning: dbProblem || cacheProblem || this.rng.bool(0.08),
      errorMessage: checkoutProblem ? ERROR_MESSAGE : 'Unexpected 500 response',
      highCardinality: this.config.scenario === 'high-cardinality',
    };
  }

  private createSpanSteps(
    pattern: RequestPattern,
    rootSpanId: string,
    context: ReturnType<TelemetryGenerator['scenarioContext']>,
  ): SpanStep[] {
    if (pattern.kind === 'checkout') {
      return this.checkoutSteps(rootSpanId, context);
    }
    if (pattern.kind === 'search') {
      return this.cacheBackedSteps(rootSpanId, 'search-service', 'search.query', context);
    }
    if (pattern.kind === 'recommendations') {
      return this.cacheBackedSteps(
        rootSpanId,
        'recommendation-service',
        'recommendation.rank',
        context,
      );
    }
    return [
      this.step(
        rootSpanId,
        'inventory-service',
        'inventory.listProducts',
        'CLIENT',
        14,
        30,
        context,
      ),
    ];
  }

  private checkoutSteps(
    rootSpanId: string,
    context: ReturnType<TelemetryGenerator['scenarioContext']>,
  ): SpanStep[] {
    const checkoutSpanId = this.rng.hex(8);
    const orderSpanId = this.rng.hex(8);
    const paymentSlow =
      this.config.scenario === 'checkout-error' || this.config.scenario === 'bad-deploy';
    const dbSlow = this.config.scenario === 'database-degradation';

    const checkoutStep = this.step(
      rootSpanId,
      'checkout-service',
      'checkout.process',
      'SERVER',
      28,
      paymentSlow ? 720 : 110,
      context,
    );
    checkoutStep.id = checkoutSpanId;
    const orderStep = this.step(
      checkoutSpanId,
      'order-service',
      'order.create',
      'CLIENT',
      118,
      dbSlow ? 680 : 80,
      context,
    );
    orderStep.id = orderSpanId;

    return [
      this.step(rootSpanId, 'auth-service', 'auth.validateToken', 'CLIENT', 8, 16, context),
      checkoutStep,
      this.step(
        checkoutSpanId,
        'inventory-service',
        'inventory.reserveItem',
        'CLIENT',
        44,
        42,
        context,
      ),
      this.step(
        checkoutSpanId,
        'payment-service',
        'payment.chargeCard',
        'CLIENT',
        82,
        paymentSlow ? 840 : 95,
        {
          ...context,
          isError: paymentSlow || context.isError,
          errorMessage: paymentSlow ? ERROR_MESSAGE : context.errorMessage,
        },
      ),
      orderStep,
      this.step(orderSpanId, 'postgres-db', 'postgres.query', 'CLIENT', 138, dbSlow ? 940 : 35, {
        ...context,
        isWarning: dbSlow || context.isWarning,
      }),
      this.step(orderSpanId, 'kafka-broker', 'kafka.publish', 'PRODUCER', 170, 18, context),
    ];
  }

  private cacheBackedSteps(
    rootSpanId: string,
    serviceName: ServiceName,
    operationName: string,
    context: ReturnType<TelemetryGenerator['scenarioContext']>,
  ): SpanStep[] {
    const appSpanId = this.rng.hex(8);
    const cacheStorm = this.config.scenario === 'cache-miss-storm';
    const appStep = this.step(
      rootSpanId,
      serviceName,
      operationName,
      'SERVER',
      25,
      cacheStorm ? 360 : 65,
      context,
    );
    appStep.id = appSpanId;
    return [
      this.step(rootSpanId, 'auth-service', 'auth.validateToken', 'CLIENT', 8, 14, context),
      appStep,
      this.step(appSpanId, 'redis-cache', 'redis.get', 'CLIENT', 40, cacheStorm ? 220 : 9, {
        ...context,
        isWarning: cacheStorm || context.isWarning,
      }),
    ];
  }

  private step(
    parentId: string,
    serviceName: ServiceName,
    operationName: string,
    kind: SpanKind,
    offsetMs: number,
    baseDurationMs: number,
    context: ReturnType<TelemetryGenerator['scenarioContext']>,
  ): SpanStep {
    const statusCode =
      context.isError && serviceName !== 'postgres-db' && serviceName !== 'redis-cache'
        ? 'ERROR'
        : 'OK';
    return {
      id: this.rng.hex(8),
      parentId,
      serviceName,
      operationName,
      kind,
      offsetMs,
      durationMs: Math.max(1, Math.round(baseDurationMs * this.rng.float(0.75, 1.35))),
      statusCode,
      statusMessage: statusCode === 'ERROR' ? context.errorMessage : '',
      attributes: {
        'peer.service': serviceName,
        scenario: this.config.scenario,
      },
    };
  }

  private toSpan(traceId: string, timestamp: Date, step: SpanStep): SpanTelemetry {
    const serviceVersion =
      step.serviceName === 'checkout-service' && this.config.scenario === 'bad-deploy'
        ? 'v1.4.2'
        : DEFAULT_VERSION_BY_SERVICE[step.serviceName];
    return {
      traceId,
      spanId: step.id,
      parentSpanId: step.parentId,
      timestamp: new Date(timestamp.getTime() + step.offsetMs).toISOString(),
      serviceName: step.serviceName,
      environment: this.config.environment,
      operationName: step.operationName,
      durationMs: step.durationMs,
      statusCode: step.statusCode,
      statusMessage: step.statusMessage,
      kind: step.kind,
      attributes: {
        ...step.attributes,
        'service.version': serviceVersion,
        ...this.highCardinalityAttributes(),
      },
      resourceAttributes: this.resourceAttributes(step.serviceName, serviceVersion),
    };
  }

  private logsForSpan(
    traceId: string,
    timestamp: Date,
    step: SpanStep,
    context: ReturnType<TelemetryGenerator['scenarioContext']>,
  ): LogTelemetry[] {
    const logs: LogTelemetry[] = [];
    logs.push(this.log(traceId, timestamp, step, 'INFO', `${step.operationName} started`));

    if (step.operationName === 'payment.chargeCard') {
      logs.push(this.log(traceId, timestamp, step, 'INFO', 'Payment provider request sent'));
    }
    if (step.operationName === 'inventory.reserveItem' && step.statusCode !== 'ERROR') {
      logs.push(this.log(traceId, timestamp, step, 'INFO', 'Inventory reservation succeeded'));
    }
    if (step.operationName === 'order.create' && step.statusCode !== 'ERROR') {
      logs.push(this.log(traceId, timestamp, step, 'INFO', 'Order persisted'));
    }
    if (step.operationName === 'redis.get') {
      const severity: LogSeverity = this.config.scenario === 'cache-miss-storm' ? 'WARN' : 'INFO';
      logs.push(
        this.log(
          traceId,
          timestamp,
          step,
          severity,
          this.config.scenario === 'cache-miss-storm' ? 'Cache miss' : 'Cache hit',
        ),
      );
    }
    if (step.operationName === 'postgres.query') {
      const slow = this.config.scenario === 'database-degradation';
      logs.push(
        this.log(
          traceId,
          timestamp,
          step,
          slow ? 'WARN' : 'INFO',
          slow ? 'Slow query warning: order lookup exceeded 900ms' : 'Database query completed',
        ),
      );
    }
    if (step.statusCode === 'ERROR') {
      logs.push(
        this.log(traceId, timestamp, step, 'ERROR', step.statusMessage || context.errorMessage),
      );
      logs.push(this.log(traceId, timestamp, step, 'WARN', 'Retry attempt started'));
    } else {
      logs.push(
        this.log(
          traceId,
          timestamp,
          step,
          context.isWarning ? 'WARN' : 'INFO',
          `${step.operationName} completed`,
        ),
      );
    }

    return logs;
  }

  private log(
    traceId: string,
    timestamp: Date,
    step: SpanStep,
    severity: LogSeverity,
    message: string,
  ): LogTelemetry {
    const serviceVersion =
      step.serviceName === 'checkout-service' && this.config.scenario === 'bad-deploy'
        ? 'v1.4.2'
        : DEFAULT_VERSION_BY_SERVICE[step.serviceName];
    return {
      timestamp: new Date(
        timestamp.getTime() + step.offsetMs + this.rng.int(0, Math.max(1, step.durationMs)),
      ).toISOString(),
      serviceName: step.serviceName,
      environment: this.config.environment,
      severity,
      message,
      traceId,
      spanId: step.id,
      attributes: {
        operation: step.operationName,
        duration_ms: step.durationMs,
        scenario: this.config.scenario,
        ...this.highCardinalityAttributes(),
      },
      resourceAttributes: this.resourceAttributes(step.serviceName, serviceVersion),
    };
  }

  private metricsForRequest(
    timestamp: Date,
    pattern: RequestPattern,
    steps: SpanStep[],
    context: ReturnType<TelemetryGenerator['scenarioContext']>,
  ): MetricTelemetry[] {
    const metrics: MetricTelemetry[] = [];
    const root = steps[0]!;
    const services = [...new Set(steps.map((step) => step.serviceName))];
    const labels = {
      route: pattern.route,
      method: pattern.method,
      scenario: this.config.scenario,
      ...this.highCardinalityAttributes(),
    };

    metrics.push(
      this.metric(
        timestamp,
        root.serviceName,
        'http.server.request.duration',
        'gauge',
        root.durationMs,
        'ms',
        labels,
      ),
    );
    metrics.push(
      this.metric(timestamp, root.serviceName, 'http.server.request.count', 'sum', 1, '1', labels),
    );
    if (root.statusCode === 'ERROR') {
      metrics.push(
        this.metric(timestamp, root.serviceName, 'http.server.error.count', 'sum', 1, '1', labels),
      );
    }

    for (const service of services) {
      metrics.push(
        this.metric(
          timestamp,
          service,
          'service.cpu.usage',
          'gauge',
          this.serviceCpu(service, context),
          'percent',
          labels,
        ),
      );
      metrics.push(
        this.metric(
          timestamp,
          service,
          'service.memory.usage',
          'gauge',
          this.rng.int(200_000_000, 2_500_000_000),
          'By',
          labels,
        ),
      );
    }

    const postgresSpan = steps.find((step) => step.serviceName === 'postgres-db');
    if (postgresSpan) {
      metrics.push(
        this.metric(
          timestamp,
          'postgres-db',
          'db.query.duration',
          'gauge',
          postgresSpan.durationMs,
          'ms',
          labels,
        ),
      );
    }

    const redisSpan = steps.find((step) => step.serviceName === 'redis-cache');
    if (redisSpan) {
      const missStorm = this.config.scenario === 'cache-miss-storm';
      metrics.push(
        this.metric(
          timestamp,
          'redis-cache',
          'cache.hit.count',
          'sum',
          missStorm ? 0 : 1,
          '1',
          labels,
        ),
      );
      metrics.push(
        this.metric(
          timestamp,
          'redis-cache',
          'cache.miss.count',
          'sum',
          missStorm ? this.rng.int(8, 30) : this.rng.int(0, 1),
          '1',
          labels,
        ),
      );
    }

    const kafkaSpan = steps.find((step) => step.serviceName === 'kafka-broker');
    if (kafkaSpan) {
      metrics.push(
        this.metric(timestamp, 'kafka-broker', 'queue.publish.count', 'sum', 1, '1', labels),
      );
      metrics.push(
        this.metric(
          timestamp,
          'kafka-broker',
          'queue.consumer.lag',
          'gauge',
          this.rng.int(0, 45),
          'messages',
          labels,
        ),
      );
    }

    const paymentSpan = steps.find((step) => step.operationName === 'payment.chargeCard');
    if (paymentSpan) {
      metrics.push(
        this.metric(
          timestamp,
          'payment-service',
          'payment.provider.latency',
          'gauge',
          paymentSpan.durationMs,
          'ms',
          labels,
        ),
      );
    }

    if (pattern.kind === 'checkout') {
      const errorRate =
        this.config.scenario === 'checkout-error' || this.config.scenario === 'bad-deploy'
          ? this.rng.float(0.12, 0.28)
          : this.config.scenario === 'database-degradation'
            ? this.rng.float(0.02, 0.06)
            : this.rng.float(0.001, 0.012);
      metrics.push(
        this.metric(
          timestamp,
          'checkout-service',
          'checkout.error_rate',
          'gauge',
          errorRate,
          'percent',
          labels,
        ),
      );
    }

    return metrics;
  }

  private metric(
    timestamp: Date,
    serviceName: ServiceName,
    metricName: string,
    metricType: 'gauge' | 'sum',
    value: number,
    unit: string,
    labels: Record<string, string | number | boolean>,
  ): MetricTelemetry {
    return {
      timestamp: timestamp.toISOString(),
      serviceName,
      environment: this.config.environment,
      metricName,
      metricType,
      value: Number(value.toFixed(4)),
      unit,
      labels: {
        service: serviceName,
        version: DEFAULT_VERSION_BY_SERVICE[serviceName],
        ...labels,
      },
      resourceAttributes: this.resourceAttributes(
        serviceName,
        DEFAULT_VERSION_BY_SERVICE[serviceName],
      ),
    };
  }

  private heartbeatMetrics(timestamp: Date): MetricTelemetry[] {
    const labels = {
      scenario: this.config.scenario,
      heartbeat: true,
      ...this.highCardinalityAttributes(),
    };
    const context = {
      isError: false,
      isWarning: false,
      errorMessage: '',
      highCardinality: this.config.scenario === 'high-cardinality',
    };

    return this.servicesForHeartbeat().flatMap((service) => [
      this.metric(
        timestamp,
        service,
        'service.cpu.usage',
        'gauge',
        this.serviceCpu(service, context),
        'percent',
        labels,
      ),
      this.metric(
        timestamp,
        service,
        'service.memory.usage',
        'gauge',
        this.rng.int(200_000_000, 2_500_000_000),
        'By',
        labels,
      ),
    ]);
  }

  private servicesForHeartbeat(): ServiceName[] {
    if (!this.config.services || this.config.services.length === 0) {
      return [...SERVICE_TOPOLOGY];
    }
    return this.config.services as ServiceName[];
  }

  private serviceCpu(
    serviceName: ServiceName,
    context: ReturnType<TelemetryGenerator['scenarioContext']>,
  ): number {
    const stressed =
      context.isError ||
      (this.config.scenario === 'database-degradation' &&
        ['order-service', 'postgres-db'].includes(serviceName)) ||
      (this.config.scenario === 'cache-miss-storm' &&
        ['search-service', 'recommendation-service', 'redis-cache'].includes(serviceName));
    return this.rng.float(stressed ? 70 : 18, stressed ? 96 : 55);
  }

  private resourceAttributes(serviceName: ServiceName, version: string): Record<string, string> {
    return {
      'service.version': version,
      'k8s.namespace.name': this.config.environment,
      'telemetry.generator': 'rootpilot-simulator',
      'telemetry.scenario': this.config.scenario,
      'rootpilot.tenant': this.config.tenant,
      'rootpilot.project': this.config.project,
      'service.role':
        serviceName.endsWith('-db') ||
        serviceName.endsWith('-cache') ||
        serviceName.endsWith('-broker')
          ? 'dependency'
          : 'service',
    };
  }

  private highCardinalityAttributes(): Record<string, string> {
    if (this.config.scenario !== 'high-cardinality') return {};
    return {
      user_id: `user_${this.rng.hex(4)}`,
      session_id: `sess_${this.rng.hex(8)}`,
      request_id: `req_${this.sequence}_${this.rng.hex(4)}`,
      noisy_scenario: 'intentionally-high-cardinality',
    };
  }
}

function bumpPatch(version: string): string {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return version;
  return `v${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function randomUuid(rng: SeededRandom): string {
  const bytes = Array.from({ length: 16 }, () => rng.int(0, 255));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}
