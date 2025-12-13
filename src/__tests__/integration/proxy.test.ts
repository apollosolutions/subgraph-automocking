import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { MockingProxyServer } from '../../server';
import { SubgraphRegistry } from '../../services/SubgraphRegistry';
import { SchemaCache } from '../../services/SchemaCache';
import { ApolloClient } from '../../services/ApolloClient';
import { IntrospectionService } from '../../services/IntrospectionService';
import { MockHandler } from '../../handlers/MockHandler';
import { MockGenerator } from '../../services/MockGenerator';
import { promises as fs } from 'fs';
import { PassThroughHandler } from '../../handlers/PassThroughHandler';
import * as environment from '../../config/environment';

// Simple product schema used across all tests

const PRODUCT_SCHEMA_SDL = `
  type Product {
    id: ID!
    name: String
    price: Float
  }

  type Query {
    product(id: ID!): Product
    products: [Product!]!
  }
`.trim();

// mock hash for product schema
const PRODUCT_SCHEMA_HASH = 'testhash1234567890';

// Mock ApolloClient to prevent actual network requests
vi.mock('../../services/ApolloClient', () => {
  const MockApolloClient = vi.fn().mockImplementation(function() {
    this.verifyConnection = vi.fn().mockResolvedValue(true);
    this.listSubgraphs = vi.fn().mockResolvedValue([]);
    this.fetchSubgraphSchema = vi.fn().mockRejectedValue(new Error('Schema not found'));
    this.generateSchemaHash = vi.fn().mockReturnValue(PRODUCT_SCHEMA_HASH);
  });

  return {
    ApolloClient: MockApolloClient,
  };
});

// Mock IntrospectionService to prevent actual network requests
vi.mock('../../services/IntrospectionService', () => {
  const MockIntrospectionService = vi.fn().mockImplementation(function() {
    this.introspect = vi.fn().mockResolvedValue({
      success: false,
      error: 'Introspection failed',
      duration: 0,
    });
  });

  return {
    IntrospectionService: MockIntrospectionService,
  };
});

// Mock only fs.promises.readFile; keep everything else from the real fs
vi.mock('fs', async () => {
  const actualFs = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actualFs,
    promises: {
      ...actualFs.promises,
      readFile: vi.fn(),
    },
  };
});


// Note: These tests run against the local express instance, simulating integration
// For full E2E with Docker, we would need to use testcontainers or run against the docker-compose service URL
describe('Integration: Mocking Proxy', () => {
  let server: MockingProxyServer;
  let registry: SubgraphRegistry;
  let mockPassThroughHandler: PassThroughHandler;

  beforeAll(async () => {
    // Initialize server with mocked ApolloClient (created automatically by vi.mock)
    registry = new SubgraphRegistry();
    mockPassThroughHandler = new PassThroughHandler();
    mockPassThroughHandler.handleRequest = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));
    server = new MockingProxyServer({
      subgraphRegistry: registry,
      apolloClient: new ApolloClient(),
      passThroughHandler: mockPassThroughHandler,
    });

    // Start server (without listening on port to avoid conflicts)
    // We use supertest which takes the express app directly
  });

  afterAll(async () => {
    await server.stop();
  });

  describe('Health Check Routes', () => {
    it('GET / should return 200 OK', async () => {
      const response = await request(server.getApp()).get('/');
      expect(response.status).toBe(200);
      expect(response.body.service).toBe('mocking-proxy');
      expect(response.body.status).toBe('running');
    });

    it('GET /health should return detailed health', async () => {
      const response = await request(server.getApp()).get('/health');
      expect(response.status).toBe(200);
      expect(response.body.checks.server.status).toBe('healthy');
    });

    it('GET /live should return 200', async () => {
      const response = await request(server.getApp()).get('/live');
      expect(response.status).toBe(200);
    });

    it('GET /ready should return 200', async () => {
      const response = await request(server.getApp()).get('/ready');
      expect(response.status).toBe(200);
    });
  });

  describe('Proxy Functionality', () => {
    it('should handle requests to unknown subgraphs (default to mock/error)', async () => {
      const targetUrl = encodeURIComponent('http://unknown-service:4000/graphql');
      const response = await request(server.getApp())
        .post(`/${targetUrl}`)
        .set('x-subgraph-name', 'unknown')
        .send({
          query: '{ __typename }'
        });

      expect(response.status).toBe(404);
      expect(response.body.errors[0].message).toContain('Schema not found for subgraph: unknown');
    });
  });

  describe('Schema Source: Apollo Registry', () => {
    it('should successfully mock responses using Apollo registry schema', async () => {
      // Mock Apollo client to return product schema
      const mockApolloClient = new ApolloClient();

      // Use vi.spyOn to mock the method on the instance
      vi.spyOn(mockApolloClient, 'fetchSubgraphSchema').mockResolvedValue({
        sdl: PRODUCT_SCHEMA_SDL,
        version: PRODUCT_SCHEMA_HASH,
      });

      // Create mock introspection service
      const mockIntrospectionService = new IntrospectionService();

      // Create schema cache with mocked services
      const testSchemaCache = new SchemaCache(mockApolloClient, mockIntrospectionService);

      // Register subgraph config with schema cache (this is what SubgraphInitializer does)
      testSchemaCache.setSubgraphConfig('products', 'http://products:4001/graphql', {
        useLocalSchema: false,
        forceMock: false,
        disableMocking: false,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      });

      // Create server with mocked services
      const testRegistry = new SubgraphRegistry();
      testRegistry.registerSubgraph('products', 'http://products:4001/graphql');

      const testServer = new MockingProxyServer({
        subgraphRegistry: testRegistry,
        apolloClient: mockApolloClient,
        schemaCache: testSchemaCache,
      });

      const targetUrl = encodeURIComponent('http://products:4001/graphql');
      const response = await request(testServer.getApp())
        .post(`/${targetUrl}`)
        .set('x-subgraph-name', 'products')
        .send({
          query: 'query TestQuery { products { id name price } }'
        });

      // Should return mocked data based on product schema
      expect(response.status).toBe(200);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.products).toBeDefined();
      expect(Array.isArray(response.body.data.products)).toBe(true);

      await testServer.stop();
    });
  });

  describe('Schema Source: Local File', () => {
    it('should successfully mock responses using local schema file', async () => {
      // Mock fs.readFile to return product schema
      vi.mocked(fs.readFile).mockResolvedValue(PRODUCT_SCHEMA_SDL);

      // Mock Apollo client (won't be used for schema loading)
      const mockApolloClient = new ApolloClient();

      // Create mock introspection service
      const mockIntrospectionService = new IntrospectionService();

      // Create schema cache with mocked services
      const testSchemaCache = new SchemaCache(mockApolloClient, mockIntrospectionService);

      const subgraphConfig = {
        schemaFile: 'products.graphql',
        useLocalSchema: true,
        forceMock: false,
        disableMocking: false,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      };

      // Register subgraph config with schema cache
      testSchemaCache.setSubgraphConfig('products', 'http://products:4001/graphql', subgraphConfig);

      // Create server with file-based schema config
      const testRegistry = new SubgraphRegistry();
      testRegistry.registerSubgraph('products', 'http://products:4001/graphql', subgraphConfig);

      const testServer = new MockingProxyServer({
        subgraphRegistry: testRegistry,
        apolloClient: mockApolloClient,
        schemaCache: testSchemaCache,
      });

      const targetUrl = encodeURIComponent('http://products:4001/graphql');
      const response = await request(testServer.getApp())
        .post(`/${targetUrl}`)
        .set('x-subgraph-name', 'products')
        .send({
          query: 'query TestQuery { products { id name price } }'
        });

      // Should return mocked data based on product schema from file
      expect(response.status).toBe(200);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.products).toBeDefined();
      expect(Array.isArray(response.body.data.products)).toBe(true);
      expect(fs.readFile).toHaveBeenCalledWith(expect.stringMatching(/products\.graphql$/), 'utf-8');

      await testServer.stop();
    });

    it('should use PassThroughHandler when passthrough is enabled and subgraph is available', async () => {
      const expectedData = {
        products: [
          { id: 'p1', name: 'Local File Product', price: 42.5 },
        ],
      };

      // Mock isPassthroughEnabled to return true (enables passthrough mode)
      const isPassthroughEnabledSpy = vi.spyOn(environment, 'isPassthroughEnabled').mockReturnValue(true);

      // Mock fs.readFile to return product schema
      vi.mocked(fs.readFile).mockResolvedValue(PRODUCT_SCHEMA_SDL);

      // Mock Apollo client (won't be used for schema loading)
      const mockApolloClient = new ApolloClient();

      // Create mock introspection service
      const mockIntrospectionService = new IntrospectionService();

      // Create schema cache with mocked services
      const testSchemaCache = new SchemaCache(mockApolloClient, mockIntrospectionService);

      const subgraphConfig = {
        schemaFile: 'products.graphql',
        useLocalSchema: true,
        forceMock: false,
        disableMocking: false,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      };

      // Register subgraph config with schema cache
      testSchemaCache.setSubgraphConfig('products', 'http://products:4001/graphql', subgraphConfig);

      // Create server with file-based schema config and mock PassThroughHandler
      const testRegistry = new SubgraphRegistry();
      testRegistry.registerSubgraph('products', 'http://products:4001/graphql', subgraphConfig);

      // Mock isSubgraphAvailable to return true so passthrough is used
      vi.spyOn(testRegistry, 'isSubgraphAvailable').mockResolvedValue(true);

      const mockGenerator = new MockGenerator();
      const passThroughHandler = new PassThroughHandler();

      // Mock the handleRequest method to return our custom data
      // handleRequest writes to the response object, so we need to mock it properly
      vi.spyOn(passThroughHandler, 'handleRequest').mockImplementation(async (req, res) => {
        res.status(200).json({ data: expectedData });
      });

      const mockHandler = new MockHandler(testSchemaCache, mockGenerator);

      const testServer = new MockingProxyServer({
        subgraphRegistry: testRegistry,
        apolloClient: mockApolloClient,
        schemaCache: testSchemaCache,
        mockHandler,
        passThroughHandler,
      });

      const targetUrl = encodeURIComponent('http://products:4001/graphql');
      const response = await request(testServer.getApp())
        .post(`/${targetUrl}`)
        .set('x-subgraph-name', 'products')
        .send({
          query: 'query TestQuery { products { id name price } }'
        });

      // Verify PassThroughHandler was called (not MockHandler)
      expect(passThroughHandler.handleRequest).toHaveBeenCalled();

      // Verify response contains our custom data
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(expectedData);

      // Restore mocks
      isPassthroughEnabledSpy.mockRestore();

      await testServer.stop();
    });
  });

  describe('Schema Source: Local Introspection', () => {
    it('should successfully mock responses using local introspection', async () => {
      // Mock introspection service to return product schema
      const mockIntrospectionService = new IntrospectionService();
      // Mock introspect (the actual method called by SchemaCache)
      mockIntrospectionService.introspect = vi.fn().mockResolvedValue({
        success: true,
        sdl: PRODUCT_SCHEMA_SDL,
        duration: 50,
      });

      // Mock Apollo client (won't be used for schema loading)
      const mockApolloClient = new ApolloClient();

      // Create schema cache with mocked services
      const testSchemaCache = new SchemaCache(mockApolloClient, mockIntrospectionService);

      const subgraphConfig = {
        useLocalSchema: true,
        forceMock: false,
        disableMocking: false,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      };

      // Register subgraph config with schema cache
      testSchemaCache.setSubgraphConfig('products', 'http://localhost:4001/graphql', subgraphConfig);

      // Create server with introspection-based schema config
      const testRegistry = new SubgraphRegistry();
      testRegistry.registerSubgraph('products', 'http://localhost:4001/graphql', subgraphConfig);

      const testServer = new MockingProxyServer({
        subgraphRegistry: testRegistry,
        apolloClient: mockApolloClient,
        introspectionService: mockIntrospectionService,
        schemaCache: testSchemaCache,
      });

      const targetUrl = encodeURIComponent('http://localhost:4001/graphql');
      const response = await request(testServer.getApp())
        .post(`/${targetUrl}`)
        .set('x-subgraph-name', 'products')
        .send({
          query: '{ products { id name price } }'
        });

      // Should return mocked data based on product schema from introspection
      expect(response.status).toBe(200);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.products).toBeDefined();
      expect(Array.isArray(response.body.data.products)).toBe(true);

      // Verify introspection was called
      expect(mockIntrospectionService.introspect).toHaveBeenCalledWith(
        'http://localhost:4001/graphql',
        expect.any(Object),
        undefined
      );

      await testServer.stop();
    });
  });
});
