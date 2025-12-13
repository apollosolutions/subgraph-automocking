import { z } from 'zod';

/**
 * Schema source type
 */
export type SchemaSource = 'local-introspection' | 'apollo-registry' | 'unknown';

/**
 * Subgraph routing status
 */
export type SubgraphStatus = 'available' | 'unavailable' | 'mocking' | 'unknown';

/**
 * Zod schema for individual subgraph configuration
 */
const SubgraphConfigItemSchema = z.object({
  // Routing behavior
  forceMock: z.boolean().default(false),
  disableMocking: z.boolean().default(false),
  useLocalSchema: z.boolean().default(false),
  url: z.url().optional(),
  schemaFile: z.string().optional(),

  // Introspection headers (sent with introspection queries)
  introspectionHeaders: z.record(z.string(), z.string()).optional(),

  // Retry configuration
  maxRetries: z.number().int().min(0).max(10).default(3),
  retryDelayMs: z.number().int().min(100).max(30000).default(1000),
  healthCheckIntervalMs: z.number().int().min(5000).max(300000).default(30000),
}).refine(
  (config) => !(config.forceMock && config.disableMocking),
  {
    message: 'forceMock and disableMocking cannot both be true',
    path: ['forceMock', 'disableMocking'],
  }
);

/**
 * Zod schema for the entire configuration file
 */
export const SubgraphsConfigSchema = z.object({
  subgraphs: z.record(z.string(), SubgraphConfigItemSchema),
});

/**
 * TypeScript types derived from Zod schemas
 */
export type SubgraphConfigItem = z.infer<typeof SubgraphConfigItemSchema>;
export type SubgraphsConfig = z.infer<typeof SubgraphsConfigSchema>;

/**
 * Subgraph runtime state
 */
export interface SubgraphState {
  name: string;
  url: string | undefined;
  status: SubgraphStatus;
  schemaSource: SchemaSource;
  isMocking: boolean;
  isHealthy: boolean;
  lastHealthCheck?: Date;
  consecutiveFailures: number;
  config: SubgraphConfigItem;
}

/**
 * Default configuration for a subgraph
 */
export const DEFAULT_SUBGRAPH_CONFIG: SubgraphConfigItem = {
  forceMock: false,
  disableMocking: false,
  useLocalSchema: false,
  maxRetries: 2,
  retryDelayMs: 1000,
  healthCheckIntervalMs: 30000,
};

/**
 * Validates subgraph configuration
 */
export function validateSubgraphConfig(config: unknown): SubgraphsConfig {
  return SubgraphsConfigSchema.parse(config);
}

/**
 * Determines routing behavior based on configuration and current state
 */
export function determineRoutingBehavior(
  config: SubgraphConfigItem,
  isHealthy: boolean,
  consecutiveFailures: number
): {
  shouldMock: boolean;
  shouldPassthrough: boolean;
  schemaSource: SchemaSource;
} {
  // Rule 1: forceMock always mocks
  if (config.forceMock) {
    return {
      shouldMock: true,
      shouldPassthrough: false,
      schemaSource: config.useLocalSchema ? 'local-introspection' : 'apollo-registry',
    };
  }

  // Rule 2: disableMocking never mocks
  if (config.disableMocking) {
    return {
      shouldMock: false,
      shouldPassthrough: true,
      schemaSource: config.useLocalSchema ? 'local-introspection' : 'apollo-registry',
    };
  }

  // Rule 3: If healthy, passthrough
  if (isHealthy) {
    return {
      shouldMock: false,
      shouldPassthrough: true,
      schemaSource: config.useLocalSchema ? 'local-introspection' : 'apollo-registry',
    };
  }

  // Rule 4: If retries exhausted, start mocking
  if (consecutiveFailures >= config.maxRetries) {
    return {
      shouldMock: true,
      shouldPassthrough: false,
      schemaSource: config.useLocalSchema ? 'local-introspection' : 'apollo-registry',
    };
  }

  // Default: attempt passthrough (still retrying)
  return {
    shouldMock: false,
    shouldPassthrough: true,
    schemaSource: config.useLocalSchema ? 'local-introspection' : 'apollo-registry',
  };
}
