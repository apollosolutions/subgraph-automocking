import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { env } from '../config/environment';
import { SubgraphConfigItem, SubgraphState } from '../config/subgraphConfig';
import { logger } from '../middleware/requestLogger';

/**
 * Health check result for a subgraph
 */
export interface HealthCheckResult {
  isHealthy: boolean;
  error?: string;
  timestamp: Date;
}

/**
 * Monitors health and manages state for configured subgraphs
 *
 * Tracks availability, manages retry counters, and coordinates schema sources.
 *
 * @example
 * ```typescript
 * const monitor = new SubgraphHealthMonitor(introspectionService);
 *
 * monitor.registerSubgraph('products', {
 *   localEndpoint: 'http://localhost:4001',
 *   maxRetries: 3,
 *   retryDelayMs: 1000
 * });
 *
 * const state = monitor.getState('products');
 * console.log(state.isHealthy);
 * ```
 */
export class SubgraphHealthMonitor {
  private states: Map<string, SubgraphState> = new Map();
  private healthCheckIntervals: Map<string, NodeJS.Timeout> = new Map();
  private httpClient: AxiosInstance;

  constructor(httpClient: AxiosInstance = axios) {
    this.httpClient = httpClient;
  }

  /**
   * Registers a subgraph for monitoring
   *
   * @param name - Subgraph name
   * @param url - Subgraph URL for health checks
   * @param config - Subgraph configuration
   */
  public registerSubgraph(name: string, url: string | undefined, config: SubgraphConfigItem): void {
    const isMocking = config.forceMock || !url ? true : false;
    const initialState: SubgraphState = {
      name,
      url,
      status: 'unknown',
      schemaSource: config.useLocalSchema ? 'local-introspection' : 'apollo-registry',
      isMocking,
      isHealthy: false,
      consecutiveFailures: 0,
      config,
    };

    this.states.set(name, initialState);
    logger.info({ name, url }, '[HealthMonitor] Registered subgraph');

    // Always start periodic health checks (unless forceMock)
    if (!config.forceMock) {
      this.startHealthChecks(name);
    }
  }

  /**
   * Performs a health check for a subgraph
   *
   * @param name - Subgraph name
   * @returns Health check result
   */
  public async checkHealth(name: string): Promise<HealthCheckResult> {
    const state = this.states.get(name);
    if (!state) {
      throw new Error(`Subgraph ${name} not registered`);
    }

    const isHealthy = state.url ? await this.checkEndpointHealth(state.url) : false;

    const healthResult: HealthCheckResult = {
      isHealthy,
      timestamp: new Date(),
    };

    // Update state based on health check
    this.updateStateFromHealthCheck(name, healthResult);

    return healthResult;
  }

  /**
   * Performs a lightweight HTTP health check against a GraphQL endpoint.
   * Matches the legacy behavior used by SubgraphRegistry.
   */
  public async checkEndpointHealth(
    endpoint: string,
    timeoutMs: number = env.SUBGRAPH_HEALTH_TIMEOUT_MS
  ): Promise<boolean> {
    try {
      const response: AxiosResponse = await this.httpClient.post(
        endpoint,
        {"query":"query { __typename }"},
        {
          timeout: timeoutMs,
          headers: {
            'content-type': 'application/json',
            'x-apollo-operation-name': 'TypenameQuery',
          },
        }
      );

      return response.status === 200;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.debug(
          { endpoint, error: error.message },
          '[HealthMonitor] HTTP health check failed'
        );
      }
      return false;
    }
  }

  /**
   * Updates subgraph state based on health check result
   *
   * @param name - Subgraph name
   * @param result - Health check result
   */
  private updateStateFromHealthCheck(name: string, result: HealthCheckResult): void {
    const state = this.states.get(name);
    if (!state) return;

    const wasHealthy = state.isHealthy;

    if (result.isHealthy) {
      // Health check succeeded
      state.isHealthy = true;
      state.consecutiveFailures = 0;
      state.status = 'available';
      state.lastHealthCheck = result.timestamp;
      state.isMocking = state.config.forceMock || false;

      if (!wasHealthy) {
        logger.info({ name }, '[HealthMonitor] Subgraph is now healthy');
      }
    } else {
      // Health check failed
      state.isHealthy = false;
      state.consecutiveFailures++;
      state.lastHealthCheck = result.timestamp;

      // Determine if we should start mocking
      const shouldMock =
        state.config.forceMock ||
        (!state.config.disableMocking && state.consecutiveFailures >= state.config.maxRetries);

      if (shouldMock) {
        state.status = 'mocking';
        state.isMocking = true;
        logger.warn(
          { name, consecutiveFailures: state.consecutiveFailures, maxRetries: state.config.maxRetries },
          '[HealthMonitor] Subgraph health check failed'
        );
      } else {
        state.status = 'unavailable';
        logger.warn(`[HealthMonitor] Subgraph ${name} health check failed (${state.consecutiveFailures}/${state.config.maxRetries})`);
      }
    }

    this.states.set(name, state);
  }

  /**
   * Gets current state for a subgraph
   *
   * @param name - Subgraph name
   * @returns Subgraph state or undefined
   */
  public getState(name: string): SubgraphState | undefined {
    return this.states.get(name);
  }

  /**
   * Gets all subgraph states
   *
   * @returns Array of all subgraph states
   */
  public getAllStates(): SubgraphState[] {
    return Array.from(this.states.values());
  }

  /**
   * Manually marks a subgraph as healthy or unhealthy
   *
   * @param name - Subgraph name
   * @param isHealthy - Health status
   */
  public setHealth(name: string, isHealthy: boolean): void {
    const state = this.states.get(name);
    if (!state) return;

    if (isHealthy) {
      state.isHealthy = true;
      state.consecutiveFailures = 0;
      state.status = 'available';
      state.isMocking = state.config.forceMock || false;
    } else {
      state.isHealthy = false;
      state.consecutiveFailures++;

      if (state.consecutiveFailures >= state.config.maxRetries && !state.config.disableMocking) {
        state.status = 'mocking';
        state.isMocking = true;
      } else {
        state.status = 'unavailable';
      }
    }

    this.states.set(name, state);
  }

  /**
   * Starts periodic health checks for a subgraph
   *
   * @param name - Subgraph name
   */
  private startHealthChecks(name: string): void {
    const state = this.states.get(name);
    if (!state || !state.config.healthCheckIntervalMs) return;

    // Clear existing interval if any
    this.stopHealthChecks(name);

    const interval = setInterval(() => {
      void (async () => {
        try {
          await this.checkHealth(name);
        } catch (error) {
          logger.error({ name, error }, '[HealthMonitor] Health check error');
        }
      })();
    }, state.config.healthCheckIntervalMs);

    this.healthCheckIntervals.set(name, interval);
    logger.info({ name, intervalMs: state.config.healthCheckIntervalMs }, '[HealthMonitor] Started health checks');
  }

  /**
   * Stops periodic health checks for a subgraph
   *
   * @param name - Subgraph name
   */
  private stopHealthChecks(name: string): void {
    const interval = this.healthCheckIntervals.get(name);
    if (interval) {
      clearInterval(interval);
      this.healthCheckIntervals.delete(name);
      logger.info({ name }, '[HealthMonitor] Stopped health checks');
    }
  }

  /**
   * Stops all health checks and cleans up resources
   */
  public shutdown(): void {
    for (const name of this.healthCheckIntervals.keys()) {
      this.stopHealthChecks(name);
    }
    this.states.clear();
    logger.info('[HealthMonitor] Shutdown complete');
  }
}
