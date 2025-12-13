import express, { Express, Request, Response } from 'express';
import { Server } from 'http';
import { env, getPort, isPassthroughEnabled } from './config/environment';
import { logger, requestLoggerMiddleware, logGraphQLOperation } from './middleware/requestLogger';
import { errorHandler, notFoundHandler, asyncHandler, ProxyError, ErrorCodes } from './middleware/errorHandler';
import { urlDecoderMiddleware, RequestWithTargetUrl } from './middleware/urlDecoder';
import {
  detailedHealthCheckHandler,
  livenessCheckHandler,
  readinessCheckHandler,
  HealthStatus,
  createComponentHealth,
  ComponentHealth
} from './utils/healthCheck';
import { SubgraphRegistry } from './services/SubgraphRegistry';
import { SchemaCache } from './services/SchemaCache';
import { IntrospectionService } from './services/IntrospectionService';
import { PassThroughHandler } from './handlers/PassThroughHandler';
import { MockHandler } from './handlers/MockHandler';
import { ApolloClient } from './services/ApolloClient';
import { MockGenerator } from './services/MockGenerator';
import { SubgraphInitializer } from './services/SubgraphInitializer';

/**
 * Mocking Proxy Server
 *
 * Express-based HTTP server that acts as a GraphQL mocking proxy, intercepting
 * requests to subgraph services and either forwarding them to real services or
 * generating mock responses based on cached schemas.
 *
 * The server provides:
 * - Path-based URL routing with encoded target URLs
 * - Health check endpoints for Kubernetes readiness/liveness probes
 * - Structured logging with pino.js
 * - Comprehensive error handling with GraphQL-formatted responses
 * - Graceful shutdown support
 *
 * @example
 * ```typescript
 * import { MockingProxyServer } from './server';
 *
 * const server = new MockingProxyServer();
 * await server.start();
 *
 * // Later, for graceful shutdown
 * await server.stop();
 * ```
 */
export class MockingProxyServer {
  private app: Express;
  private server: Server | null = null;
  private isShuttingDown = false;
  private isInitialized = false;

  /** Service dependencies */
  private subgraphRegistry: SubgraphRegistry;
  private schemaCache: SchemaCache;
  private passThroughHandler: PassThroughHandler;
  private mockHandler: MockHandler;
  private apolloClient: ApolloClient;

  /**
   * Create a new MockingProxyServer instance
   *
   * Initializes the Express application and sets up all middleware,
   * routes, and error handlers.
   *
   * @param {object} dependencies - Service dependencies (registry, handlers, etc.)
   */
  constructor(dependencies?: {
    subgraphRegistry?: SubgraphRegistry;
    schemaCache?: SchemaCache;
    passThroughHandler?: PassThroughHandler;
    mockHandler?: MockHandler;
    apolloClient?: ApolloClient;
    introspectionService?: IntrospectionService;
  }) {
    this.app = express();

    this.apolloClient = dependencies?.apolloClient || new ApolloClient();
    const introspectionService = dependencies?.introspectionService || new IntrospectionService();
    this.subgraphRegistry = dependencies?.subgraphRegistry || new SubgraphRegistry();
    this.schemaCache = dependencies?.schemaCache || new SchemaCache(this.apolloClient, introspectionService);
    this.passThroughHandler = dependencies?.passThroughHandler || new PassThroughHandler(this.schemaCache);
    this.mockHandler = dependencies?.mockHandler || new MockHandler(this.schemaCache, new MockGenerator());

    // Setup server
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandlers();

    logger.info('MockingProxyServer instance created');
  }

  /**
   * Setup Express middleware
   *
   * Configures middleware in the correct order:
   * 1. Request logging (pino-http)
   * 2. Body parsing (JSON and URL-encoded)
   * 3. GraphQL operation logging
   *
   * @private
   */
  private setupMiddleware(): void {
    // Request logging with pino-http
    // Must be first to log all requests
    this.app.use(requestLoggerMiddleware);

    // Body parsing middleware
    // Increased limit to handle large GraphQL queries
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Log GraphQL operations
    this.app.use(logGraphQLOperation);

    logger.debug('Middleware configured');
  }

  /**
   * Setup application routes
   *
   * Configures all HTTP endpoints including:
   * - Health check endpoints (/, /health, /ready, /live)
   * - Main proxy endpoint (/:encodedUrl)
   *
   * @private
   */
  private setupRoutes(): void {
    // Root health check - simple alive check
    this.app.get('/', (_req: Request, res: Response) => {
      res.status(200).json({
        service: 'mocking-proxy',
        status: 'running',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
      });
    });

    // Liveness probe - checks if server is running
    this.app.get('/live', livenessCheckHandler());

    // Readiness probe - checks if server is ready to accept traffic
    this.app.get('/ready', readinessCheckHandler(() => {
      // Server is ready if not shutting down and dependencies are available
      if (this.isShuttingDown) {
        return false;
      }

      // Add more readiness checks here (e.g., schema cache initialized)
      return true;
    }));

    // Detailed health check with component status
    this.app.get('/health', detailedHealthCheckHandler(() => {
      const checks: Record<string, ComponentHealth> = {
        server: createComponentHealth(
          HealthStatus.HEALTHY,
          'Server is running',
          {
            port: getPort(),
            environment: env.NODE_ENV,
            uptime: process.uptime(),
          }
        ),
      };

      // Add subgraph registry health if available
      const subgraphs = this.subgraphRegistry.getAllSubgraphs();
      const healthyCount = subgraphs.filter(s => s.isAvailable).length;
      const totalCount = subgraphs.length;

      checks['subgraphRegistry'] = createComponentHealth(
        totalCount === 0 ? HealthStatus.DEGRADED :
        healthyCount === 0 ? HealthStatus.UNHEALTHY :
        healthyCount < totalCount ? HealthStatus.DEGRADED :
        HealthStatus.HEALTHY,
        `${healthyCount}/${totalCount} subgraphs available`,
        {
          totalSubgraphs: totalCount,
          healthySubgraphs: healthyCount,
          unhealthySubgraphs: totalCount - healthyCount,
        }
      );

      // Add schema cache health if available
      checks['schemaCache'] = createComponentHealth(
        HealthStatus.HEALTHY,
        'Schema cache active',
        {
          cacheEnabled: true,
          ttlMs: env.SCHEMA_CACHE_TTL_MS,
        }
      );

      return checks;
    }));

    // Subgraph status endpoint - shows mocking status and schema sources
    this.app.get('/status', (_req: Request, res: Response) => {
      const subgraphs = this.subgraphRegistry.getAllSubgraphs();
      const healthMonitor = this.subgraphRegistry.getHealthMonitor();

      // Enhance subgraph info with additional state from health monitor
      const enhancedSubgraphs = subgraphs.map(subgraph => {
        const monitorState = healthMonitor?.getState?.(subgraph.name);

        return {
          name: subgraph.name,
          url: subgraph.url,
          status: monitorState?.status || (subgraph.isAvailable ? 'available' : 'unavailable'),
          isHealthy: subgraph.isAvailable,
          isMocking: subgraph.isMocking,
          schemaSource: subgraph.schemaSource,
          lastCheck: subgraph.lastCheck,
          consecutiveFailures: subgraph.consecutiveFailures,
          config: monitorState?.config ? {
            forceMock: monitorState.config.forceMock,
            disableMocking: monitorState.config.disableMocking,
            useLocalSchema: monitorState.config.useLocalSchema,
            maxRetries: monitorState.config.maxRetries,
          } : undefined,
        };
      });

      res.status(200).json({
        timestamp: new Date().toISOString(),
        totalSubgraphs: subgraphs.length,
        healthySubgraphs: subgraphs.filter(s => s.isAvailable).length,
        mockingSubgraphs: subgraphs.filter(s => s.isMocking).length,
        subgraphs: enhancedSubgraphs,
      });
    });

    // Main proxy endpoint: POST /:encodedUrl
    // Handles GraphQL requests with URL-encoded target in path
    this.app.post(
      '/:encodedUrl',
      urlDecoderMiddleware,
      asyncHandler(async (req: Request, res: Response) => {
        const { targetUrl, subgraphName } = req as RequestWithTargetUrl;

        logger.info({
          targetUrl,
          subgraphName,
          hasQuery: !!(req.body && typeof req.body === 'object' && 'query' in req.body),
          headers: req.headers,
          body: req.body,
        }, 'Processing proxy request');

        // Determine routing: passthrough vs. mock
        const shouldPassthrough = await this.subgraphRegistry.shouldPassthroughToSubgraph(subgraphName, targetUrl);

        // Route to appropriate handler
        if (shouldPassthrough) {
          // Forward to real subgraph
          logger.info({ targetUrl, subgraphName }, 'Forwarding request to real subgraph');
          await this.passThroughHandler.handleRequest(req, res, targetUrl);
        } else if (subgraphName) {
          // Generate mock response
          logger.info({ targetUrl, subgraphName }, 'Generating mock response');
          await this.mockHandler.handleRequest(req, res, subgraphName);
        } else {
          // Cannot determine how to handle request
          throw new ProxyError(
            'Cannot process request: no handler available',
            ErrorCodes.INTERNAL_SERVER_ERROR,
            500,
            {
              targetUrl,
              subgraphName,
              reason: !subgraphName ? 'Could not determine subgraph name' : 'No mock handler configured',
            }
          );
        }
      })
    );

    logger.debug('Routes configured');
  }

  /**
   * Setup error handling middleware
   *
   * Must be registered after all routes to catch errors.
   * Handles both 404 errors and general application errors.
   *
   * @private
   */
  private setupErrorHandlers(): void {
    // 404 handler for undefined routes
    this.app.use(notFoundHandler);

    // Global error handler
    this.app.use(errorHandler);

    logger.debug('Error handlers configured');
  }

  /**
   * Initialize subgraphs from Apollo Registry with local config overrides
   *
   * Uses SubgraphInitializer service to perform three-phase initialization:
   * 1. Load ALL subgraphs from Apollo Platform API (ensures complete supergraph coverage)
   * 2. Load local configuration file (if present)
   * 3. Override Apollo subgraphs with local config for matching names
   *
   * This ensures all subgraphs are available while allowing selective local overrides
   * for development (e.g., pointing one subgraph to localhost while others use Apollo as the schema source).
   *
   * @private
   * @returns {Promise<void>} Resolves when initialization is complete
   */
  private async initializeSubgraphs(): Promise<void> {
    if (this.isInitialized) {
      logger.debug('Subgraphs already initialized, skipping');
      return;
    }

    try {
      const initializer = new SubgraphInitializer(
        this.apolloClient,
        this.subgraphRegistry,
        this.schemaCache
      );

      await initializer.initialize();
      this.isInitialized = true;
    } catch (error) {
      logger.error({ error }, 'Failed to initialize subgraphs');
      throw error;
    }
  }

  /**
   * Start the HTTP server
   *
   * Starts the Express server on the configured port and initializes
   * background tasks for schema caching and health checking.
   *
   * @returns {Promise<void>} Resolves when server is listening
   *
   * @example
   * ```typescript
   * const server = new MockingProxyServer();
   * await server.start();
   * console.log('Server is running');
   * ```
   */
  public async start(): Promise<void> {
    const port = getPort();

    // Initialize subgraphs before starting server
    try {
      await this.initializeSubgraphs();

      // Start background tasks if dependencies are available
      await this.subgraphRegistry.startHealthChecks();
      logger.info('Subgraph health checks started');

      this.schemaCache.startPeriodicRefresh();

      // Start HTTP server
      this.server = this.app.listen(port, () => {
        logger.info({
          port,
          environment: env.NODE_ENV,
          passthroughEnabled: isPassthroughEnabled(),
          logLevel: env.LOG_LEVEL,
          subgraphCount: this.subgraphRegistry.getSubgraphCount(),
        }, `Mocking proxy server listening on port ${port}`)
      });

      // Handle server errors
      this.server.on('error', (error: Error) => {
        logger.error({ err: error }, 'Server error');
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to start server');
      throw error;
    }
  }

  /**
   * Stop the HTTP server gracefully
   *
   * Performs graceful shutdown:
   * 1. Stops accepting new connections
   * 2. Stops background tasks
   * 3. Waits for existing requests to complete
   * 4. Closes server
   *
   * @param {number} timeout - Maximum time to wait for graceful shutdown (ms)
   * @returns {Promise<void>} Resolves when server is stopped
   *
   * @example
   * ```typescript
   * // Graceful shutdown with 30 second timeout
   * await server.stop(30000);
   * ```
   */
  public async stop(timeout: number = 30000): Promise<void> {
    if (this.isShuttingDown) {
      logger.warn('Server is already shutting down');
      return;
    }

    this.isShuttingDown = true;
    logger.info('Starting graceful shutdown');

    return new Promise((resolve, reject) => {
      // Stop background tasks
      this.subgraphRegistry.stopHealthChecks();
      logger.info('Subgraph health checks stopped');

      this.schemaCache.stopPeriodicRefresh();
      logger.info('Schema cache refresh stopped');

      // Close server
      if (!this.server) {
        logger.info('Server was not running');
        resolve();
        return;
      }

      // Set shutdown timeout
      const shutdownTimeout = setTimeout(() => {
        logger.error('Graceful shutdown timeout, forcing shutdown');
        reject(new Error('Shutdown timeout'));
      }, timeout);

      // Close server gracefully
      this.server.close((err) => {
        clearTimeout(shutdownTimeout);

        if (err) {
          logger.error({ err }, 'Error during shutdown');
          reject(err);
        } else {
          logger.info('Server stopped successfully');
          this.server = null;
          resolve();
        }
      });
    });
  }

  /**
   * Get the Express application instance
   *
   * Useful for testing or adding additional middleware/routes.
   *
   * @returns {Express} Express application
   */
  public getApp(): Express {
    return this.app;
  }

  /**
   * Check if server is running
   *
   * @returns {boolean} True if server is listening
   */
  public isRunning(): boolean {
    return this.server !== null && this.server.listening;
  }
}
