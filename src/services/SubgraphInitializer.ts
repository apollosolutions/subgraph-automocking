import { ApolloClient } from './ApolloClient';
import { SubgraphRegistry } from './SubgraphRegistry';
import { SchemaCache } from './SchemaCache';
import { loadSubgraphConfig } from '../config/configLoader';
import { logger } from '../middleware/requestLogger';
import { DEFAULT_SUBGRAPH_CONFIG } from '../config/subgraphConfig';

/**
 * Result of subgraph initialization
 */
export interface InitializationResult {
  /** Total number of registered subgraphs */
  totalSubgraphs: number;
  /** Number of subgraphs from Apollo only */
  fromApollo: number;
  /** Number of subgraphs with local overrides */
  localOverrides: number;
}

/**
 * Service responsible for initializing subgraphs from Apollo Platform and local configuration
 *
 * Handles the three-phase initialization process:
 * 1. Fetch all subgraphs from Apollo Platform API
 * 2. Load local configuration overrides
 * 3. Merge and register subgraphs with the registry
 *
 * @example
 * ```typescript
 * const initializer = new SubgraphInitializer(apolloClient, registry, schemaCache);
 * const result = await initializer.initialize();
 * console.log(`Initialized ${result.totalSubgraphs} subgraphs`);
 * ```
 */
export class SubgraphInitializer {
  constructor(
    private readonly apolloClient: ApolloClient,
    private readonly registry: SubgraphRegistry,
    private readonly schemaCache: SchemaCache
  ) {}

  /**
   * Initialize all subgraphs from Apollo Platform and local configuration
   *
   * @returns Promise resolving to initialization result
   * @throws {Error} If initialization fails
   */
  public async initialize(): Promise<InitializationResult> {
    logger.info('[SubgraphInitializer] Starting subgraph initialization');

    const apolloSubgraphs = await this.fetchFromApollo();
    const localConfig = await this.loadLocalConfig();
    const result = await this.mergeAndRegister(apolloSubgraphs, localConfig);

    logger.info({
      totalSubgraphs: result.totalSubgraphs,
      fromApollo: result.fromApollo,
      localOverrides: result.localOverrides
    }, '[SubgraphInitializer] Subgraph initialization complete');

    return result;
  }

  /**
   * Fetch all subgraphs from Apollo Platform API
   *
   * @private
   * @returns Promise resolving to array of Apollo subgraph information
   * @throws {Error} If Apollo API is unreachable or returns no subgraphs
   */
  private async fetchFromApollo(): Promise<Array<{ name: string; url: string | null | undefined }>> {
    logger.debug('[SubgraphInitializer] Phase 1: Loading subgraphs from Apollo Registry');

    // Verify connection to Apollo Platform API
    await this.apolloClient.verifyConnection();

    // List all subgraphs from Apollo Platform
    const apolloSubgraphs = await this.apolloClient.listSubgraphs();

    if (apolloSubgraphs.length === 0) {
      logger.warn('[SubgraphInitializer] No subgraphs found in Apollo Registry');
    } else {
      logger.debug({
        count: apolloSubgraphs.length,
        subgraphs: apolloSubgraphs.map(s => s.name)
      }, '[SubgraphInitializer] Discovered subgraphs from Apollo Registry');
    }

    return apolloSubgraphs;
  }

  /**
   * Load local configuration overrides
   *
   * @private
   * @returns Promise resolving to local subgraph configuration
   */
  private async loadLocalConfig() {
    logger.info('[SubgraphInitializer] Phase 2: Loading local configuration overrides');

    const localConfig = await loadSubgraphConfig();
    const localSubgraphs = Object.keys(localConfig.subgraphs);

    if (localSubgraphs.length === 0) {
      logger.info('[SubgraphInitializer] No local configuration found');
    } else {
      logger.info({
        count: localSubgraphs.length,
        subgraphs: localSubgraphs
      }, '[SubgraphInitializer] Found local configuration overrides');
    }

    return localConfig;
  }

  /**
   * Merge Apollo subgraphs with local configuration and register them
   *
   * @private
   * @param apolloSubgraphs - Subgraphs from Apollo Platform
   * @param localConfig - Local configuration overrides
   * @returns Promise resolving to initialization result
   */
  private async mergeAndRegister(
    apolloSubgraphs: Array<{ name: string; url: string | null | undefined }>,
    localConfig: Awaited<ReturnType<typeof loadSubgraphConfig>>
  ): Promise<InitializationResult> {
    logger.info('[SubgraphInitializer] Phase 3: Merging and registering subgraphs');

    const localSubgraphNames = Object.keys(localConfig.subgraphs);

    // Register all subgraphs from Apollo (will be overridden later if in local config)
    for (const subgraph of apolloSubgraphs) {
      const url = subgraph.url || undefined;

      if (!url) {
        logger.warn(
          { name: subgraph.name },
          '[SubgraphInitializer] No URL found for subgraph - will mock if schema available'
        );
      }

      this.registry.registerSubgraph(subgraph.name, url);
      this.schemaCache.setSubgraphConfig(subgraph.name, url, DEFAULT_SUBGRAPH_CONFIG);
      logger.debug({ name: subgraph.name, url }, '[SubgraphInitializer] Registered subgraph from Apollo');
    }

    // Pre-fetch all Apollo schemas into cache
    logger.info('[SubgraphInitializer] Pre-fetching schemas for all subgraphs');
    const schemaNames = apolloSubgraphs.map(s => s.name);
    await this.schemaCache.warmCache(schemaNames);
    logger.info({ count: schemaNames.length }, '[SubgraphInitializer] Apollo schemas cached');

    // Apply local configuration overrides
    for (const [name, subgraphConfig] of Object.entries(localConfig.subgraphs)) {

      const url = subgraphConfig.url;
      // Unregister the Apollo version
      this.registry.unregisterSubgraph(name);

      // Re-register with local configuration
      this.registry.registerSubgraph(name, url, subgraphConfig);
      this.schemaCache.setSubgraphConfig(name, url, subgraphConfig);

      logger.info({
        name,
        url,
        forceMock: subgraphConfig.forceMock,
        useLocalSchema: subgraphConfig.useLocalSchema,
        schemaFile: subgraphConfig.schemaFile
      }, '[SubgraphInitializer] Applied local override for subgraph');
    }

    const finalCount = this.registry.getSubgraphCount();
    const overriddenCount = localSubgraphNames.length;
    const apolloOnlyCount = finalCount - overriddenCount;

    return {
      totalSubgraphs: finalCount,
      fromApollo: apolloOnlyCount,
      localOverrides: overriddenCount,
    };
  }
}
