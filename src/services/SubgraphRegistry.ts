import { env, isPassthroughEnabled } from '../config/environment';
import { SubgraphHealthMonitor } from './SubgraphHealthMonitor';
import { SubgraphConfigItem, SubgraphState, DEFAULT_SUBGRAPH_CONFIG } from '../config/subgraphConfig';
import { logger } from '../middleware/requestLogger';

/**
 * Represents a registered subgraph with its health status
 */
export class SubgraphInfo {
  /** Unique name of the subgraph */
  public readonly name: string;
  /** GraphQL endpoint URL */
  public readonly url: string | undefined;
  /** Reference to health monitor for state access */
  private readonly healthMonitor: SubgraphHealthMonitor;

  constructor(name: string, url: string | undefined, healthMonitor: SubgraphHealthMonitor) {
    this.name = name;
    this.url = url;
    this.healthMonitor = healthMonitor;
  }

  /**
   * Get current health state from SubgraphHealthMonitor.
   * Returns dynamic properties: isHealthy, isMocking, consecutiveFailures, etc.
   */
  public getState(): SubgraphState | undefined {
    return this.healthMonitor.getState(this.name);
  }

  /**
   * Convenience getters that delegate to SubgraphHealthMonitor state
   */
  public get isAvailable(): boolean {
    return this.getState()?.isHealthy ?? false;
  }

  public get lastCheck(): Date {
    return this.getState()?.lastHealthCheck ?? new Date();
  }

  public get consecutiveFailures(): number {
    return this.getState()?.consecutiveFailures ?? 0;
  }

  public get isMocking(): boolean {
    return this.getState()?.isMocking ?? false;
  }

  public get schemaSource(): 'local-introspection' | 'apollo-registry' | 'unknown' {
    return this.getState()?.schemaSource ?? 'unknown';
  }
}

/**
 * Registry for tracking subgraph availability and health
 *
 * Maintains a registry of all known subgraphs and performs periodic
 * health checks to determine which subgraphs are available. This enables
 * the mocking proxy to make intelligent decisions about when to mock
 * versus when to pass through requests.
 *
 * @example
 * ```typescript
 * const registry = new SubgraphRegistry();
 * registry.registerSubgraph('products', 'http://products-service:4001');
 * registry.startHealthChecks();
 *
 * // Later...
 * const isAvailable = await registry.isSubgraphAvailable('http://products-service:4001');
 * ```
 */
export class SubgraphRegistry {
  private registry: Map<string, SubgraphInfo> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private healthMonitor: SubgraphHealthMonitor;

  /**
   * Creates a new SubgraphRegistry
   *
   * @param checkIntervalMs - Interval between health checks in milliseconds
   * @param healthTimeoutMs - Timeout for individual health check requests
   * @param healthMonitor - Optional SubgraphHealthMonitor instance (creates default if not provided)
   */
  constructor(
    private readonly checkIntervalMs: number = env.SUBGRAPH_CHECK_INTERVAL_MS,
    private readonly healthTimeoutMs: number = env.SUBGRAPH_HEALTH_TIMEOUT_MS,
    healthMonitor?: SubgraphHealthMonitor
  ) {
    this.healthMonitor = healthMonitor || new SubgraphHealthMonitor();
  }

  /**
   * Start periodic health checking of all registered subgraphs
   *
   * Performs an immediate health check of all registered subgraphs,
   * then initiates a background timer that checks all registered subgraphs
   * at the configured interval. Health checks run concurrently for
   * all subgraphs to minimize total check time.
   *
   * This ensures the service has accurate health status immediately
   * upon initialization rather than waiting for the first interval.
   *
   * @throws {Error} If health checks are already running
   */
  public async startHealthChecks(): Promise<void> {
    if (this.checkInterval) {
      throw new Error('Health checks are already running');
    }

    // Run initial health check immediately to populate accurate status
    await this.checkAllSubgraphs();

    // Then set up periodic checks
    this.checkInterval = setInterval(() => {
      this.checkAllSubgraphs().catch((error) => {
        logger.error({ error }, '[SubgraphRegistry] Error during periodic health check');
      });
    }, this.checkIntervalMs);

    logger.info({ intervalMs: this.checkIntervalMs }, '[SubgraphRegistry] Health checks started');
  }

  /**
   * Stop health checking
   *
   * Stops the background health check timer. Does nothing if
   * health checks are not currently running.
   */
  public stopHealthChecks(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      logger.info('[SubgraphRegistry] Health checks stopped');
    }
  }

  /**
   * Register a subgraph for tracking
   *
   * Adds a subgraph to the registry for health monitoring. If the
   * subgraph is already registered, this method does nothing.
   *
   * When a config is provided, enables advanced health monitoring with
   * local introspection, retry logic, and intelligent mocking decisions.
   *
   * @param name - Unique identifier for the subgraph
   * @param url - GraphQL endpoint URL for the subgraph (undefined if no URL available)
   * @param config - Optional subgraph configuration for advanced monitoring
   *
   * @example
   * ```typescript
   * // Basic registration
   * registry.registerSubgraph('products', 'http://products-service:4001');
   *
   * // With configuration
   * registry.registerSubgraph('products', 'http://products:4001', {
   *   localEndpoint: 'http://localhost:4001/graphql',
   *   forceMock: false,
   *   maxRetries: 3,
   *   useLocalSchema: true
   * });
   *
   * // Without URL (schema from file or Apollo registry only)
   * registry.registerSubgraph('products', undefined, {
   *   schemaFile: 'products.graphql',
   *   forceMock: true
   * });
   * ```
   */
  public registerSubgraph(name: string, url: string | undefined, config?: SubgraphConfigItem): void {
    if (!name) {
      throw new Error('Subgraph name is required');
    }
    const subgraphConfig: SubgraphConfigItem = config ?? DEFAULT_SUBGRAPH_CONFIG;

    const registryEntry = this.createRegistryEntryWithConfig(name, url, subgraphConfig)

    this.registry.set(name, registryEntry);
    logger.info({ name, url }, `[SubgraphRegistry] Registered subgraph with ${config ? '' : 'default'} config`);
  }


  /**
   * Create a registry entry with advanced configuration
   *
   * @private
   * @param name - Subgraph name
   * @param url - Subgraph URL (undefined if no URL available)
   * @param config - Subgraph configuration
   * @returns Configured subgraph info
   */
  private createRegistryEntryWithConfig(
    name: string,
    url: string | undefined,
    config: SubgraphConfigItem
  ): SubgraphInfo {
    // Register with health monitor for advanced tracking
    this.healthMonitor.registerSubgraph(name, url, config);

    // Create SubgraphInfo that delegates to health monitor
    return new SubgraphInfo(name, url, this.healthMonitor);
  }

  /**
   * Check if a specific subgraph is available
   *
   * For registered subgraphs, returns the cached availability status.
   * For unknown subgraphs, performs a one-time health check.
   *
   * @param url - GraphQL endpoint URL to check
   * @returns Promise resolving to true if the subgraph is available
   *
   * @example
   * ```typescript
   * const isAvailable = await registry.isSubgraphAvailable('http://products-service:4001');
   * if (isAvailable) {
   *   // Pass through to real subgraph
   * } else {
   *   // Use mock response
   * }
   * ```
   */
  public async isSubgraphAvailable(url: string): Promise<boolean> {
    const subgraph = this.getSubgraphByUrl(url);

    if (!subgraph) {
      // Unknown subgraph - perform one-time check
      return await this.healthMonitor.checkEndpointHealth(url, this.healthTimeoutMs);
    }

    return subgraph.isAvailable;
  }

  public async shouldPassthroughToSubgraph(name: string | undefined, url: string | undefined): Promise<boolean> {

    if (!isPassthroughEnabled()) {
      return false;
    }

    let subgraph: SubgraphInfo | undefined;

    if (name) {
      subgraph = this.getSubgraphByName(name);
    } else if (url) {
      subgraph = this.getSubgraphByUrl(url);
    }

    if (!subgraph) {
      return false;
    }

    if (subgraph.isMocking) {
      return false;
    }

    return this.isSubgraphAvailable(subgraph.url!);
  }

  /**
   * Get subgraph info by URL
   *
   * @param url - GraphQL endpoint URL
   * @returns SubgraphInfo if found, undefined otherwise
   */
  public getSubgraphByUrl(url: string): SubgraphInfo | undefined {
    return Array.from<SubgraphInfo>(this.registry.values()).find(s => s.url === url);
  }

  /**
   * Get subgraph info by name
   *
   * @param name - Subgraph name
   * @returns SubgraphInfo if found, undefined otherwise
   */
  public getSubgraphByName(name: string): SubgraphInfo | undefined {
    return this.registry.get(name);
  }

  /**
   * Get all registered subgraphs
   *
   * @returns Array of all registered subgraph information
   */
  public getAllSubgraphs(): SubgraphInfo[] {
    return Array.from<SubgraphInfo>(this.registry.values());
  }

  /**
   * Get count of registered subgraphs
   *
   * @returns Number of registered subgraphs
   */
  public getSubgraphCount(): number {
    return this.registry.size;
  }


  /**
   * Check all registered subgraphs concurrently
   *
   * Performs health checks for all registered subgraphs in parallel.
   * This is called periodically by the background timer when health checks are enabled.
   *
   * All subgraphs are registered with SubgraphHealthMonitor.
   */
  private async checkAllSubgraphs(): Promise<void> {
    const checks = Array.from(this.registry.entries()).map(async ([name]) => {
      await this.healthMonitor.checkHealth(name);
      const state = this.healthMonitor.getState(name);

      if (!state?.isHealthy) {
        logger.warn({ name, consecutiveFailures: state?.consecutiveFailures || 0 }, '[SubgraphRegistry] Subgraph unhealthy');
      }
    });

    await Promise.all(checks);
  }


  /**
   * Get the health monitor instance
   *
   * @returns SubgraphHealthMonitor instance
   */
  public getHealthMonitor(): SubgraphHealthMonitor {
    return this.healthMonitor;
  }

  /**
   * Unregister a subgraph
   *
   * Removes a subgraph from the registry. Useful for testing or
   * dynamic subgraph management.
   *
   * @param name - Name of the subgraph to remove
   * @returns true if the subgraph was removed, false if it didn't exist
   */
  public unregisterSubgraph(name: string): boolean {
    const deleted = this.registry.delete(name);
    if (deleted) {
      logger.info({ name }, '[SubgraphRegistry] Unregistered subgraph');
    }
    return deleted;
  }

  /**
   * Clear all registered subgraphs
   *
   * Removes all subgraphs from the registry. Useful for testing.
   */
  public clearAll(): void {
    this.registry.clear();
    logger.info('[SubgraphRegistry] Cleared all registered subgraphs');
  }
}

/**
 * Singleton instance for global subgraph registry
 */
export const subgraphRegistry = new SubgraphRegistry();
