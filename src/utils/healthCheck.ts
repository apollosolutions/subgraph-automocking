import { Request, Response } from 'express';

/**
 * Health Check Utilities
 *
 * Provides utilities for implementing health check endpoints and monitoring
 * service health in the mocking proxy.
 */

/**
 * Health status enumeration
 *
 * Defines possible health states for the service and its dependencies.
 */
export enum HealthStatus {
  /** Service is healthy and operating normally */
  HEALTHY = 'healthy',
  /** Service is degraded but still functional */
  DEGRADED = 'degraded',
  /** Service is unhealthy and may not function properly */
  UNHEALTHY = 'unhealthy',
}

/**
 * Health check response interface
 *
 * Standard structure for health check responses following
 * common health check patterns and best practices.
 */
export interface HealthCheckResponse {
  /** Overall health status */
  status: HealthStatus;
  /** ISO 8601 timestamp of the health check */
  timestamp: string;
  /** Service uptime in seconds */
  uptime: number;
  /** Application version (from package.json) */
  version?: string;
  /** Detailed checks for individual components */
  checks?: {
    [componentName: string]: ComponentHealth;
  };
  /** Additional metadata */
  metadata?: {
    environment?: string;
    hostname?: string;
    [key: string]: unknown;
  };
}

/**
 * Individual component health information
 */
export interface ComponentHealth {
  /** Component health status */
  status: HealthStatus;
  /** Component-specific message */
  message?: string;
  /** Last check timestamp */
  lastCheck?: string;
  /** Component-specific metrics */
  metrics?: {
    [metricName: string]: number | string | boolean;
  };
}

/**
 * Health check options
 */
export interface HealthCheckOptions {
  /** Include detailed component checks */
  includeDetails?: boolean;
  /** Include system metrics */
  includeMetrics?: boolean;
  /** Custom version string */
  version?: string;
}

/**
 * Service start time for uptime calculation
 */
const SERVICE_START_TIME = Date.now();

/**
 * Get current service uptime in seconds
 *
 * @returns {number} Uptime in seconds
 */
export function getUptime(): number {
  return Math.floor((Date.now() - SERVICE_START_TIME) / 1000);
}

/**
 * Create a basic health check response
 *
 * Generates a minimal health check response with status and timestamp.
 * Useful for simple health check endpoints.
 *
 * @param {HealthStatus} status - Overall health status
 * @param {HealthCheckOptions} options - Optional configuration
 * @returns {HealthCheckResponse} Health check response object
 *
 * @example
 * ```typescript
 * const health = createHealthCheckResponse(HealthStatus.HEALTHY, {
 *   version: '1.0.0',
 *   includeMetrics: true
 * });
 * ```
 */
export function createHealthCheckResponse(
  status: HealthStatus = HealthStatus.HEALTHY,
  options: HealthCheckOptions = {}
): HealthCheckResponse {
  const response: HealthCheckResponse = {
    status,
    timestamp: new Date().toISOString(),
    uptime: getUptime(),
  };

  if (options.version) {
    response.version = options.version;
  }

  if (options.includeMetrics) {
    response.metadata = {
      environment: process.env['NODE_ENV'] || 'unknown',
      hostname: process.env['HOSTNAME'] || 'unknown',
      memoryUsage: process.memoryUsage(),
    };
  }

  return response;
}

/**
 * Determine overall health from component checks
 *
 * Aggregates individual component health statuses to determine
 * the overall service health. Uses the most severe status found.
 *
 * @param {Record<string, ComponentHealth>} checks - Component health checks
 * @returns {HealthStatus} Aggregated health status
 *
 * @example
 * ```typescript
 * const overallHealth = aggregateHealth({
 *   database: { status: HealthStatus.HEALTHY },
 *   cache: { status: HealthStatus.DEGRADED }
 * });
 * // Returns: HealthStatus.DEGRADED
 * ```
 */
export function aggregateHealth(
  checks: Record<string, ComponentHealth>
): HealthStatus {
  const statuses = Object.values(checks).map(check => check.status);

  if (statuses.includes(HealthStatus.UNHEALTHY)) {
    return HealthStatus.UNHEALTHY;
  }
  if (statuses.includes(HealthStatus.DEGRADED)) {
    return HealthStatus.DEGRADED;
  }
  return HealthStatus.HEALTHY;
}

/**
 * Create a component health check result
 *
 * Helper function to create consistent component health check objects.
 *
 * @param {HealthStatus} status - Component status
 * @param {string} message - Optional status message
 * @param {Record<string, number | string | boolean>} metrics - Optional metrics
 * @returns {ComponentHealth} Component health object
 *
 * @example
 * ```typescript
 * const dbHealth = createComponentHealth(
 *   HealthStatus.HEALTHY,
 *   'Database connection active',
 *   { connections: 5, latency: 12 }
 * );
 * ```
 */
export function createComponentHealth(
  status: HealthStatus,
  message?: string,
  metrics?: Record<string, number | string | boolean>
): ComponentHealth {
  const result: ComponentHealth = {
    status,
    lastCheck: new Date().toISOString(),
  };
  
  if (message !== undefined) {
    result.message = message;
  }
  
  if (metrics) {
    result.metrics = metrics;
  }
  
  return result;
}

/**
 * Express middleware for basic health checks
 *
 * Provides a simple health check endpoint that returns 200 OK
 * with basic service information.
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { healthCheckHandler } from './utils/healthCheck';
 *
 * const app = express();
 * app.get('/health', healthCheckHandler);
 * ```
 */
export const healthCheckHandler = (req: Request, res: Response): void => {
  const health = createHealthCheckResponse(HealthStatus.HEALTHY, {
    includeMetrics: req.query['metrics'] === 'true',
  });

  res.status(200).json(health);
};

/**
 * Express middleware for detailed health checks
 *
 * Provides a detailed health check endpoint that includes component
 * checks passed as a parameter.
 *
 * @param {Function} getComponentChecks - Function that returns component health checks
 * @returns {Function} Express request handler
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { detailedHealthCheckHandler, HealthStatus, createComponentHealth } from './utils/healthCheck';
 *
 * const app = express();
 *
 * app.get('/health/detailed', detailedHealthCheckHandler(() => ({
 *   database: createComponentHealth(HealthStatus.HEALTHY, 'Connected'),
 *   cache: createComponentHealth(HealthStatus.HEALTHY, 'Active'),
 * })));
 * ```
 */
export function detailedHealthCheckHandler(
  getComponentChecks: () => Record<string, ComponentHealth> | Promise<Record<string, ComponentHealth>>
): (req: Request, res: Response) => Promise<void> {
  return async (_req: Request, res: Response): Promise<void> => {
    try {
      const checks = await Promise.resolve(getComponentChecks());
      const status = aggregateHealth(checks);

      const health: HealthCheckResponse = {
        status,
        timestamp: new Date().toISOString(),
        uptime: getUptime(),
        checks,
      };

      // Return appropriate status code based on health
      const statusCode = status === HealthStatus.HEALTHY ? 200 :
                        status === HealthStatus.DEGRADED ? 200 : 503;

      res.status(statusCode).json(health);
    } catch {
      // If health check itself fails, return unhealthy
      const health = createHealthCheckResponse(HealthStatus.UNHEALTHY);
      res.status(503).json(health);
    }
  };
}

/**
 * Create a readiness check handler
 *
 * Readiness checks determine if the service is ready to accept traffic.
 * Unlike liveness checks, readiness checks can fail temporarily during
 * startup or when dependencies are unavailable.
 *
 * @param {Function} isReady - Function that returns true when service is ready
 * @returns {Function} Express request handler
 *
 * @example
 * ```typescript
 * app.get('/ready', readinessCheckHandler(async () => {
 *   const dbConnected = await checkDatabaseConnection();
 *   const schemasLoaded = await checkSchemasLoaded();
 *   return dbConnected && schemasLoaded;
 * }));
 * ```
 */
export function readinessCheckHandler(
  isReady: () => boolean | Promise<boolean>
): (req: Request, res: Response) => Promise<void> {
  return async (_req: Request, res: Response): Promise<void> => {
    try {
      const ready = await Promise.resolve(isReady());

      if (ready) {
        res.status(200).json({
          status: 'ready',
          timestamp: new Date().toISOString(),
        });
      } else {
        res.status(503).json({
          status: 'not_ready',
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      res.status(503).json({
        status: 'not_ready',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }
  };
}

/**
 * Create a liveness check handler
 *
 * Liveness checks determine if the service is running and should not be
 * restarted. These should only fail if the service is in an unrecoverable state.
 *
 * @returns {Function} Express request handler
 *
 * @example
 * ```typescript
 * app.get('/live', livenessCheckHandler());
 * ```
 */
export function livenessCheckHandler(): (req: Request, res: Response) => void {
  return (_req: Request, res: Response): void => {
    res.status(200).json({
      status: 'alive',
      timestamp: new Date().toISOString(),
      uptime: getUptime(),
    });
  };
}
