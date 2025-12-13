import { vi } from 'vitest';

// Mock environment variables before any modules are loaded
process.env.PORT = '4000';
process.env.ROUTER_URL = 'http://router:4000';
process.env.APOLLO_KEY = 'test-api-key';
process.env.APOLLO_GRAPH_ID = 'test-graph-id';
process.env.APOLLO_GRAPH_VARIANT = 'current';
process.env.SUBGRAPH_CHECK_INTERVAL_MS = '30000';
process.env.SUBGRAPH_HEALTH_TIMEOUT_MS = '5000';
process.env.SCHEMA_CACHE_TTL_MS = '300000';
process.env.LOG_LEVEL = 'info';

// Suppress console output during tests unless debugging
if (!process.env.DEBUG_TESTS) {
  global.console = {
    ...console,
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    // Keep error for debugging test failures
  };
}
