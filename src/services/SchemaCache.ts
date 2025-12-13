import { GraphQLSchema, parse } from 'graphql';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { ApolloClient } from './ApolloClient';
import { IntrospectionService } from './IntrospectionService';
import { SubgraphConfigItem } from '../config/subgraphConfig';
import { env } from '../config/environment';
import { logger } from '../middleware/requestLogger';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Represents a cached GraphQL schema with metadata and built schema
 */
interface CachedSchemaEntry {
  /** Built GraphQL schema object (ready to use) */
  schema: GraphQLSchema;
  /** Raw SDL (Schema Definition Language) string */
  sdl: string;
  /** Schema version identifier (typically a hash) */
  version: string;
  /** Timestamp when schema was fetched */
  lastFetched: number;
  /** Timestamp when cache entry expires */
  expiresAt: number;
}

/**
 * Cache for GraphQL schemas with automatic refresh and TTL
 *
 * Manages in-memory caching of built GraphQL schemas fetched from the Apollo Platform API.
 * Uses a Map for true in-memory caching with TTL support. Provides periodic refresh
 * to keep schemas up-to-date without manual intervention.
 *
 * Performance: Built GraphQLSchema objects are cached in memory, eliminating the need
 * to rebuild schemas from SDL on every request (which was the previous bottleneck).
 *
 * @example
 * ```typescript
 * const apolloClient = new ApolloClient();
 * const cache = new SchemaCache(apolloClient);
 * cache.startPeriodicRefresh();
 *
 * // Get a schema (from cache or fetch if not cached)
 * const schema = await cache.getSchema('products');
 * ```
 */
export class SchemaCache {
  private cache: Map<string, CachedSchemaEntry> = new Map();
  private refreshInterval: NodeJS.Timeout | null = null;
  private subgraphConfigs: Map<string, { config: SubgraphConfigItem; url: string | undefined }> = new Map();

  /**
   * Creates a new SchemaCache
   *
   * @param apolloClient - Client for fetching schemas from Apollo Platform
   * @param introspectionService - Service for introspecting local schemas
   * @param ttlMs - Time-to-live for cached schemas in milliseconds
   */
  constructor(
    private readonly apolloClient: ApolloClient,
    private readonly introspectionService: IntrospectionService,
    private readonly ttlMs = env.SCHEMA_CACHE_TTL_MS
  ) {}

  /**
   * Register subgraph configuration for schema loading
   *
   * @param name - Subgraph name
   * @param url - Subgraph URL (undefined if subgraph has no URL)
   * @param config - Subgraph configuration
   */
  public setSubgraphConfig(name: string, url: string | undefined, config: SubgraphConfigItem): void {
    this.subgraphConfigs.set(name, { config, url });
    logger.debug({ name, url, config }, '[SchemaCache] Registered subgraph config');
  }

  /**
   * Start periodic schema refresh
   *
   * Initiates a background timer that refreshes all cached schemas
   * at the configured TTL interval. This ensures schemas stay fresh
   * even for long-running proxy instances.
   *
   * @throws {Error} If periodic refresh is already running
   */
  public startPeriodicRefresh(): void {
    if (this.refreshInterval) {
      throw new Error('Periodic refresh is already running');
    }

    // Run immediately
    void (async () => {
      await this.refreshAllSchemas();
      logger.info('[SchemaCache] Refreshed all schemas');
    })();

    this.refreshInterval = setInterval(() => {
      void (async () => {
        await this.refreshAllSchemas();
      })();
    }, this.ttlMs);

    logger.info({ intervalMs: this.ttlMs }, '[SchemaCache] Periodic refresh started');
  }

  /**
   * Stop periodic refresh
   *
   * Stops the background refresh timer. Does nothing if
   * periodic refresh is not currently running.
   */
  public stopPeriodicRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
      logger.info('[SchemaCache] Periodic refresh stopped');
    }
  }

  /**
   * Get schema for a subgraph (from cache or fetch if not cached)
   *
   * Returns a cached schema if available and fresh. Otherwise, fetches
   * a fresh schema from the Apollo Platform API and caches it.
   *
   * @param subgraphName - Name of the subgraph
   * @returns Promise resolving to the GraphQL schema
   * @throws {Error} If schema cannot be fetched
   *
   * @example
   * ```typescript
   * const schema = await cache.getSchema('products');
   * // Use schema for query execution or validation
   * ```
   */
  public async getSchema(subgraphName: string): Promise<GraphQLSchema> {
    try {
      // Try to get from cache
      const cached = this.cache.get(subgraphName);
      const now = Date.now();

      if (cached && cached.expiresAt > now) {
        logger.debug({ subgraphName }, '[SchemaCache] Cache hit');
        // Return built schema directly - no parsing or rebuilding needed!
        return cached.schema;
      }

      // Cache miss or expired - fetch fresh schema
      if (cached) {
        logger.debug({ subgraphName }, '[SchemaCache] Cache expired, fetching from Apollo Platform');
      } else {
        logger.debug({ subgraphName }, '[SchemaCache] Cache miss, loading schema');
      }
      return await this.loadAndCacheSchema(subgraphName);
    } catch (error) {
      logger.error({ subgraphName, error }, '[SchemaCache] Error getting schema');
      throw error;
    }
  }


  /**
   * Load schema from local file
   *
   * @param schemaFile - Path to schema file (relative to schemas/ directory)
   * @returns Schema, SDL, and version
   */
  private async loadFromFile(schemaFile: string): Promise<{ schema: GraphQLSchema; sdl: string; version: string }> {
    const schemaPath = path.resolve(process.cwd(), 'schemas', schemaFile);

    logger.debug({ schemaPath }, '[SchemaCache] Loading schema from file');

    const sdl = await fs.readFile(schemaPath, 'utf-8');
    const schema = this.buildSchema(sdl);

    const version = this.apolloClient.generateSchemaHash(sdl);

    logger.info({ schemaFile, version }, '[SchemaCache] Loaded schema from file');

    return { schema, sdl, version };
  }

  /**
   * Load schema from introspection
   *
   * @param url - Subgraph URL
   * @param config - Subgraph configuration
   * @returns Schema, SDL, and version
   */
  private async loadFromIntrospection(url: string, config: SubgraphConfigItem): Promise<{ schema: GraphQLSchema; sdl: string; version: string }> {
    logger.debug({ url }, '[SchemaCache] Loading schema via introspection');

    const result = await this.introspectionService.introspect(
      url,
      {
        maxRetries: config.maxRetries,
        retryDelayMs: config.retryDelayMs,
      },
      config.introspectionHeaders // Pass custom headers for introspection
    );

    if (!result.success || !result.sdl) {
      throw new Error(`Failed to introspect schema from ${url}: ${result.error}`);
    }

    // Convert schema to SDL for caching
    const schema = this.buildSchema(result.sdl);
    const version = this.apolloClient.generateSchemaHash(result.sdl);

    logger.info({ url, version }, '[SchemaCache] Loaded schema via introspection');

    return { schema, sdl: result.sdl, version };
  }

  /**
   * Load schema from Apollo Platform
   *
   * @param subgraphName - Name of the subgraph
   * @returns Schema, SDL, and version
   */
  private async loadFromApollo(subgraphName: string): Promise<{ schema: GraphQLSchema; sdl: string; version: string }> {
    logger.debug({ subgraphName }, '[SchemaCache] Loading schema from Apollo Platform');

    const schemaData = await this.apolloClient.fetchSubgraphSchema(subgraphName);
    const typeDefs = parse(schemaData.sdl);
    const schema = buildSubgraphSchema({ typeDefs });

    logger.info({ subgraphName, version: schemaData.version }, '[SchemaCache] Loaded schema from Apollo Platform');

    return { schema, sdl: schemaData.sdl, version: schemaData.version };
  }

  /**
   * Load schema from configured source and cache it
   *
   * Routes to appropriate source based on configuration:
   * - If schemaFile is set, loads from file
   * - If useLocalSchema is true and URL exists, introspects from URL
   * - Otherwise, fetches from Apollo Platform
   *
   * Note: If URL is undefined, introspection is not possible and only
   * file-based or Apollo registry sources can be used.
   *
   * @param subgraphName - Name of the subgraph
   * @returns Promise resolving to the GraphQL schema
   * @throws {Error} If schema cannot be loaded
   */
  private async loadAndCacheSchema(subgraphName: string): Promise<GraphQLSchema> {
    const configInfo = this.subgraphConfigs.get(subgraphName);
    const config = configInfo?.config;
    const url = configInfo?.url;

    let schema: GraphQLSchema;
    let sdl: string;
    let version: string;

    // Route to appropriate source
    if (config?.schemaFile) {
      // Priority 1: Load from file if schemaFile is specified
      const result = await this.loadFromFile(config.schemaFile);
      schema = result.schema;
      sdl = result.sdl;
      version = result.version;
    } else if (config?.useLocalSchema && url) {
      // Priority 2: Introspect from URL if useLocalSchema is true and URL exists
      const result = await this.loadFromIntrospection(url, config);
      schema = result.schema;
      sdl = result.sdl;
      version = result.version;
    } else if (config?.useLocalSchema && !url) {
      // Error case: useLocalSchema is true but no URL and no schemaFile
      throw new Error(
        `Cannot use local schema for ${subgraphName}: no URL available and no schemaFile configured. ` +
        `Either provide a URL for introspection or configure schemaFile.`
      );
    } else {
      // Priority 3: Fetch from Apollo Platform (default)
      const result = await this.loadFromApollo(subgraphName);
      schema = result.schema;
      sdl = result.sdl;
      version = result.version;
    }

    // Cache the result
    const now = Date.now();
    const cacheEntry: CachedSchemaEntry = {
      schema,
      sdl,
      version,
      lastFetched: now,
      expiresAt: now + this.ttlMs,
    };

    this.cache.set(subgraphName, cacheEntry);
    logger.debug({ subgraphName, version }, '[SchemaCache] Cached schema');

    return schema;
  }

  /**
   * Refresh all cached schemas
   *
   * Fetches fresh versions of all currently cached schemas. This is called
   * periodically by the background timer when periodic refresh is enabled.
   * Failed refreshes are logged but don't prevent other schemas from refreshing.
   */
  private async refreshAllSchemas(): Promise<void> {
    logger.info('[SchemaCache] Refreshing all cached schemas');

    // Get all subgraph names from cache
    const subgraphNames = Array.from(this.cache.keys());

    const refreshPromises = subgraphNames.map(async (subgraphName) => {
      try {
        await this.loadAndCacheSchema(subgraphName);
      } catch (error) {
        logger.error({ subgraphName, error }, '[SchemaCache] Failed to refresh schema');
      }
    });

    await Promise.all(refreshPromises);
  }


  /**
   * Check if a schema is cached
   *
   * @param subgraphName - Name of the subgraph
   * @returns Promise resolving to true if the schema is cached and not expired
   */
  public has(subgraphName: string): boolean {
    const cached = this.cache.get(subgraphName);
    if (!cached) return false;

    const now = Date.now();
    return cached.expiresAt > now;
  }

  /**
   * Warm the cache by pre-fetching multiple schemas
   *
   * Fetches and caches schemas for multiple subgraphs in parallel.
   * This is useful during initialization to ensure all schemas are
   * available in cache before the first request.
   *
   * @param subgraphNames - Array of subgraph names to fetch
   * @returns Promise resolving when all schemas are cached
   *
   * @example
   * ```typescript
   * // Pre-fetch schemas during server initialization
   * await cache.warmCache(['products', 'reviews', 'users']);
   * ```
   */
  public async warmCache(subgraphNames: string[]): Promise<void> {
    if (subgraphNames.length === 0) {
      logger.debug('[SchemaCache] No subgraphs to warm cache');
      return;
    }

    logger.info({ count: subgraphNames.length, subgraphs: subgraphNames }, '[SchemaCache] Warming cache');

    const fetchPromises = subgraphNames.map(async (name) => {
      try {
        await this.loadAndCacheSchema(name);
        logger.debug({ subgraphName: name }, '[SchemaCache] Warmed cache for subgraph');
      } catch (err) {
        logger.error({ subgraphName: name, err }, '[SchemaCache] Failed to warm cache for subgraph');
        // Continue with other schemas even if one fails
      }
    });

    await Promise.all(fetchPromises);
    logger.info({ count: subgraphNames.length }, '[SchemaCache] Cache warming complete');
  }

  /**
   * Build a schema from SDL
   *
   * @param sdl - SDL string
   * @returns The built schema
   */
  private buildSchema(sdl: string): GraphQLSchema {
    const typeDefs = parse(sdl);
    return buildSubgraphSchema({ typeDefs });
  }
}
