import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MockingProxyServer } from '../server';
import { SubgraphRegistry } from '../services/SubgraphRegistry';
import { SchemaCache } from '../services/SchemaCache';
import { PassThroughHandler } from '../handlers/PassThroughHandler';
import { MockHandler } from '../handlers/MockHandler';
import { ApolloClient } from '../services/ApolloClient';
import { IntrospectionService } from '../services/IntrospectionService';
import request from 'supertest';

// Mock dependencies
vi.mock('../services/SubgraphRegistry');
vi.mock('../services/SchemaCache');
vi.mock('../handlers/PassThroughHandler');
vi.mock('../handlers/MockHandler');
vi.mock('../services/ApolloClient');
vi.mock('../services/IntrospectionService');
vi.mock('../services/SubgraphInitializer');

describe('MockingProxyServer', () => {
  let server: MockingProxyServer;
  let mockRegistry: SubgraphRegistry;
  let mockSchemaCache: SchemaCache;
  let mockPassThroughHandler: PassThroughHandler;
  let mockHandler: MockHandler;
  let mockApolloClient: ApolloClient;
  let mockIntrospectionService: IntrospectionService;

  beforeEach(() => {
    mockApolloClient = new ApolloClient();
    mockIntrospectionService = new IntrospectionService();
    mockRegistry = new SubgraphRegistry();
    mockSchemaCache = new SchemaCache(mockApolloClient, mockIntrospectionService);
    mockPassThroughHandler = new PassThroughHandler(mockSchemaCache);
    mockHandler = new MockHandler(mockSchemaCache, {} as any);

    // Setup default mocks
    vi.mocked(mockRegistry.getAllSubgraphs).mockReturnValue([]);
    vi.mocked(mockRegistry.getSubgraphCount).mockReturnValue(0);
    vi.mocked(mockRegistry.startHealthChecks).mockResolvedValue(undefined);
    vi.mocked(mockRegistry.stopHealthChecks).mockReturnValue(undefined);
    vi.mocked(mockRegistry.getHealthMonitor).mockReturnValue({
      getState: vi.fn().mockReturnValue(undefined),
    } as any);
    vi.mocked(mockSchemaCache.startPeriodicRefresh).mockReturnValue(undefined);
    vi.mocked(mockSchemaCache.stopPeriodicRefresh).mockReturnValue(undefined);

    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (server) {
      try {
        await server.stop();
      } catch (err) {
        // Ignore errors during cleanup
      }
    }
  });

  describe('constructor', () => {
    it('should create server with default dependencies', () => {
      server = new MockingProxyServer();
      expect(server).toBeDefined();
      expect(server.getApp()).toBeDefined();
    });

    it('should create server with injected dependencies', () => {
      server = new MockingProxyServer({
        subgraphRegistry: mockRegistry,
        schemaCache: mockSchemaCache,
        passThroughHandler: mockPassThroughHandler,
        mockHandler: mockHandler,
        apolloClient: mockApolloClient,
        introspectionService: mockIntrospectionService,
      });

      expect(server).toBeDefined();
      expect(server.getApp()).toBeDefined();
    });
  });

  describe('health check endpoints', () => {
    beforeEach(() => {
      server = new MockingProxyServer({
        subgraphRegistry: mockRegistry,
        schemaCache: mockSchemaCache,
      });
    });

    it('GET / should return service info', async () => {
      const response = await request(server.getApp()).get('/');

      expect(response.status).toBe(200);
      expect(response.body.service).toBe('mocking-proxy');
      expect(response.body.status).toBe('running');
      expect(response.body.version).toBe('1.0.0');
      expect(response.body.timestamp).toBeDefined();
    });

    it('GET /live should return 200', async () => {
      const response = await request(server.getApp()).get('/live');
      expect(response.status).toBe(200);
    });

    it('GET /ready should return 200 when server is ready', async () => {
      const response = await request(server.getApp()).get('/ready');
      expect(response.status).toBe(200);
    });

    it('GET /health should return detailed health status', async () => {
      vi.mocked(mockRegistry.getAllSubgraphs).mockReturnValue([
        {
          name: 'test',
          url: 'http://test:4001',
          isAvailable: true,
        } as any,
      ]);

      const response = await request(server.getApp()).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBeDefined();
      expect(response.body.checks).toBeDefined();
      expect(response.body.checks.server).toBeDefined();
      expect(response.body.checks.subgraphRegistry).toBeDefined();
      expect(response.body.checks.schemaCache).toBeDefined();
    });

    it('GET /status should return subgraph status', async () => {
      const mockSubgraphs = [
        {
          name: 'products',
          url: 'http://products:4001',
          isAvailable: true,
          isMocking: false,
          schemaSource: 'apollo-registry' as const,
          lastCheck: new Date(),
          consecutiveFailures: 0,
        },
      ];

      vi.mocked(mockRegistry.getAllSubgraphs).mockReturnValue(mockSubgraphs as any);

      const response = await request(server.getApp()).get('/status');

      expect(response.status).toBe(200);
      expect(response.body.totalSubgraphs).toBe(1);
      expect(response.body.healthySubgraphs).toBe(1);
      expect(response.body.subgraphs).toHaveLength(1);
      expect(response.body.subgraphs[0].name).toBe('products');
    });
  });

  describe('proxy endpoint', () => {
    beforeEach(() => {
      server = new MockingProxyServer({
        subgraphRegistry: mockRegistry,
        schemaCache: mockSchemaCache,
        passThroughHandler: mockPassThroughHandler,
        mockHandler: mockHandler,
      });

      // Mock handlers to send responses
      vi.mocked(mockPassThroughHandler.handleRequest).mockImplementation(async (_req, res) => {
        res.status(200).json({ data: {} });
      });

      vi.mocked(mockHandler.handleRequest).mockImplementation(async (_req, res) => {
        res.status(200).json({ data: {} });
      });
    });

    it('should route to mock handler when subgraph is unavailable', async () => {
      vi.mocked(mockRegistry.isSubgraphAvailable).mockResolvedValue(false);

      const targetUrl = encodeURIComponent('http://test:4001/graphql');
      const response = await request(server.getApp())
        .post(`/${targetUrl}`)
        .set('x-subgraph-name', 'test')
        .send({ query: '{ __typename }' });

      // Should successfully route to mock handler
      expect(mockHandler.handleRequest).toHaveBeenCalled();
      expect(response.status).toBe(200);
    });

    it('should route to passthrough handler when subgraph is available', async () => {
      vi.mocked(mockRegistry.shouldPassthroughToSubgraph).mockResolvedValue(true);

      const targetUrl = encodeURIComponent('http://test:4001/graphql');
      const response = await request(server.getApp())
        .post(`/${targetUrl}`)
        .set('x-subgraph-name', 'test')
        .send({ query: '{ __typename }' });

      expect(mockPassThroughHandler.handleRequest).toHaveBeenCalled();
      expect(response.status).toBe(200);
    });
  });

  describe('lifecycle methods', () => {
    it('should start server and initialize subgraphs', async () => {
      server = new MockingProxyServer({
        subgraphRegistry: mockRegistry,
        schemaCache: mockSchemaCache,
        apolloClient: mockApolloClient,
      });

      await server.start();

      expect(mockRegistry.startHealthChecks).toHaveBeenCalled();
      expect(mockSchemaCache.startPeriodicRefresh).toHaveBeenCalled();
      expect(server.isRunning()).toBe(true);
    });

    it('should stop server gracefully', async () => {
      server = new MockingProxyServer({
        subgraphRegistry: mockRegistry,
        schemaCache: mockSchemaCache,
      });

      await server.start();
      await server.stop();

      expect(mockRegistry.stopHealthChecks).toHaveBeenCalled();
      expect(mockSchemaCache.stopPeriodicRefresh).toHaveBeenCalled();
      expect(server.isRunning()).toBe(false);
    });

    it('should handle stop when server not running', async () => {
      server = new MockingProxyServer({
        subgraphRegistry: mockRegistry,
        schemaCache: mockSchemaCache,
      });

      await expect(server.stop()).resolves.not.toThrow();
    });

    it('should handle stop timeout', async () => {
      server = new MockingProxyServer({
        subgraphRegistry: mockRegistry,
        schemaCache: mockSchemaCache,
      });

      await server.start();

      // Mock server.close to never call its callback
      const originalClose = server.getApp().listen;
      vi.spyOn(server as any, 'server', 'get').mockReturnValue({
        listening: true,
        close: vi.fn(),
      });

      await expect(server.stop(100)).rejects.toThrow('Shutdown timeout');
    });

  });

  describe('getApp', () => {
    it('should return Express app instance', () => {
      server = new MockingProxyServer();
      const app = server.getApp();

      expect(app).toBeDefined();
      expect(typeof app).toBe('function'); // Express app is a function
    });
  });

  describe('isRunning', () => {
    it('should return false when server not started', () => {
      server = new MockingProxyServer({
        subgraphRegistry: mockRegistry,
        schemaCache: mockSchemaCache,
      });

      expect(server.isRunning()).toBe(false);
    });

    it('should return false when server not started', () => {
      server = new MockingProxyServer({
        subgraphRegistry: mockRegistry,
        schemaCache: mockSchemaCache,
      });

      // Before start, should return false
      expect(server.isRunning()).toBe(false);
    });

    it('should expose getApp for accessing Express instance', () => {
      server = new MockingProxyServer({
        subgraphRegistry: mockRegistry,
        schemaCache: mockSchemaCache,
      });

      const app = server.getApp();

      // Should return Express app
      expect(app).toBeDefined();
      expect(typeof app).toBe('function'); // Express app is a function
    });
  });

  describe('error handling', () => {
    it('should return 404 for unknown routes', async () => {
      server = new MockingProxyServer();

      const response = await request(server.getApp()).get('/unknown-route');
      expect(response.status).toBe(404);
    });

  });
});
