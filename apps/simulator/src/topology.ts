export const SERVICE_TOPOLOGY = [
  'api-gateway',
  'auth-service',
  'checkout-service',
  'payment-service',
  'inventory-service',
  'order-service',
  'notification-service',
  'search-service',
  'recommendation-service',
  'postgres-db',
  'redis-cache',
  'kafka-broker',
] as const;

export type ServiceName = (typeof SERVICE_TOPOLOGY)[number];

export const SERVICE_DEPENDENCIES: Record<ServiceName, ServiceName[]> = {
  'api-gateway': ['auth-service', 'checkout-service'],
  'auth-service': [],
  'checkout-service': ['inventory-service', 'payment-service', 'order-service'],
  'payment-service': [],
  'inventory-service': [],
  'order-service': ['postgres-db', 'kafka-broker'],
  'notification-service': ['kafka-broker'],
  'search-service': ['redis-cache'],
  'recommendation-service': ['redis-cache'],
  'postgres-db': [],
  'redis-cache': [],
  'kafka-broker': [],
};

export const ROUTES = [
  { method: 'GET', route: '/api/products', entryService: 'api-gateway' as ServiceName },
  { method: 'POST', route: '/api/checkout', entryService: 'api-gateway' as ServiceName },
  { method: 'GET', route: '/api/search', entryService: 'api-gateway' as ServiceName },
  { method: 'GET', route: '/api/recommendations', entryService: 'api-gateway' as ServiceName },
] as const;

export const DEFAULT_VERSION_BY_SERVICE: Record<ServiceName, string> = {
  'api-gateway': 'v1.8.0',
  'auth-service': 'v2.3.1',
  'checkout-service': 'v1.4.1',
  'payment-service': 'v3.7.2',
  'inventory-service': 'v1.9.4',
  'order-service': 'v2.2.0',
  'notification-service': 'v1.5.3',
  'search-service': 'v4.1.0',
  'recommendation-service': 'v2.8.6',
  'postgres-db': 'v16.0',
  'redis-cache': 'v7.2',
  'kafka-broker': 'v3.7',
};
