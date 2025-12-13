import { z } from 'zod';

/**
 * Environment variable validation schema
 *
 * This schema defines and validates all required and optional environment variables
 * used by the mocking proxy server. It uses Zod for runtime validation to ensure
 * the application fails fast with clear error messages if configuration is invalid.
 *
 * @example
 * ```typescript
 * import { env, envSchema } from './config/environment';
 *
 * console.log(`Server port: ${env.PORT}`);
 * console.log(`Apollo Graph ID: ${env.APOLLO_GRAPH_ID}`);
 *
 * // Use schema for testing
 * envSchema.parse({ APOLLO_API_KEY: 'test-key', ... });
 * ```
 */
export const envSchema = z.object({
  /**
   * Node environment (development, production, or test)
   * @default 'development'
   */
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  /**
   * Server port number
   * @default 3000
   */
  PORT: z.string().regex(/^\d+$/, 'PORT must be a valid number').transform(Number).default(3000),

  /**
   * Apollo Platform API key for fetching schemas
   * Required for authentication with Apollo Platform API
   * @throws Error if not provided
   */
  APOLLO_KEY: z.string({
    error: 'APOLLO_KEY is required for schema fetching from Apollo Platform',
  }).min(1, 'APOLLO_KEY cannot be empty'),

  /**
   * Apollo Graph identifier (format: account-id@graph-name)
   * @throws Error if not provided
   */
  APOLLO_GRAPH_ID: z.string({
    error: 'APOLLO_GRAPH_ID is required (format: account-id@graph-name)',
  }).min(1, 'APOLLO_GRAPH_ID cannot be empty'),

  /**
   * Apollo Graph variant/environment (e.g., 'current', 'staging', 'production')
   * @default 'current'
   */
  APOLLO_GRAPH_VARIANT: z.string().default('current'),

  /**
   * Schema cache Time-To-Live in milliseconds
   * Controls how long schemas are cached before being refreshed
   * @default 300000 (5 minutes)
   */
  SCHEMA_CACHE_TTL_MS: z.string()
    .regex(/^\d+$/, 'SCHEMA_CACHE_TTL_MS must be a valid number')
    .transform(Number)
    .default(300000),

  /**
   * Subgraph health check interval in milliseconds
   * Controls how often subgraph availability is checked
   * @default 30000 (30 seconds)
   */
  SUBGRAPH_CHECK_INTERVAL_MS: z.string()
    .regex(/^\d+$/, 'SUBGRAPH_CHECK_INTERVAL_MS must be a valid number')
    .transform(Number)
    .default(30000),

  /**
   * Subgraph health check timeout in milliseconds
   * Maximum time to wait for a health check response
   * @default 5000 (5 seconds)
   */
  SUBGRAPH_HEALTH_TIMEOUT_MS: z.string()
    .regex(/^\d+$/, 'SUBGRAPH_HEALTH_TIMEOUT_MS must be a valid number')
    .transform(Number)
    .default(5000),

  /**
   * Enable passthrough mode (forward requests to real subgraphs when available)
   * When 'true', requests are forwarded to actual subgraphs if they are healthy
   * When 'false', all requests are mocked regardless of subgraph availability
   * @default true
   */
  ENABLE_PASSTHROUGH: z.string().transform((value) => value === 'true').default(true),

  /**
   * Mock responses on subgraph errors
   * When 'true', generates mock responses if passthrough fails
   * When 'false', returns the actual error to the caller
   * @default true
   */
  MOCK_ON_ERROR: z.string().transform((value) => value === 'true').default(true),

  /**
   * Logging level for pino logger
   * Controls the minimum log level that will be output
   * @default 'info'
   */
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),

  /**
   * Pretty print logs (development only)
   * When 'true', logs are formatted for human readability
   * When 'false', logs are output as JSON (production standard)
   * @default false
   */
  LOG_PRETTY_PRINT: z.string().transform((value) => value === 'true').default(false),
});

/**
 * Parsed and validated environment configuration
 *
 * This type represents the structure of the validated environment variables
 * after they have been processed through the Zod schema.
 */
export type Environment = z.infer<typeof envSchema>;

/**
 * Validated environment configuration object
 *
 * This object contains all environment variables after validation.
 * Access environment variables through this object to ensure type safety
 * and validation guarantees.
 *
 * @throws {z.ZodError} If environment validation fails, the error will include
 *                       detailed information about which variables are invalid
 *
 * @example
 * ```typescript
 * import { env } from './config/environment';
 *
 * // Type-safe access to environment variables
 * const port = env.PORT;
 * const apiKey = env.APOLLO_API_KEY;
 *
 * if (env.ENABLE_PASSTHROUGH) {
 *   // Passthrough logic
 * }
 * ```
 */
export const env: Environment = envSchema.parse(process.env);

/**
 * Utility function to check if environment is production
 *
 * @returns {boolean} True if NODE_ENV is 'production'
 */
export const isProduction = (): boolean => env.NODE_ENV === 'production';

/**
 * Utility function to check if environment is development
 *
 * @returns {boolean} True if NODE_ENV is 'development'
 */
export const isDevelopment = (): boolean => env.NODE_ENV === 'development';

/**
 * Utility function to check if environment is test
 *
 * @returns {boolean} True if NODE_ENV is 'test'
 */
export const isTest = (): boolean => env.NODE_ENV === 'test';

/**
 * Utility function to get numeric port value
 *
 * @returns {number} Parsed port number
 */
export const getPort = (): number => env.PORT;

/**
 * Utility function to get boolean value for passthrough mode
 *
 * @returns {boolean} True if passthrough is enabled
 */
export const isPassthroughEnabled = (): boolean => env.ENABLE_PASSTHROUGH;

/**
 * Utility function to get boolean value for mock on error
 *
 * @returns {boolean} True if mocking on error is enabled
 */
export const shouldMockOnError = (): boolean => env.MOCK_ON_ERROR;
