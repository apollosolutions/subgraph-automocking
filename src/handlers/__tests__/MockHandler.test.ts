import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MockHandler } from '../../handlers/MockHandler';
import { SchemaCache } from '../../services/SchemaCache';
import { MockGenerator } from '../../services/MockGenerator';
import { buildSchema } from 'graphql';
import {
  createMockRequest,
  createMockResponse,
  createGraphQLRequest,
  assertResponseSent,
  assertErrorResponse,
  SAMPLE_QUERY,
  SAMPLE_SCHEMA_SDL,
} from '../helpers/test-utils';
import * as fs from 'fs/promises';

// Mock the dependencies
vi.mock('../../config/environment', () => ({
  env: {
    APOLLO_API_KEY: 'test-key',
    APOLLO_GRAPH_ID: 'test-graph-id',
    PORT: 3000,
    NODE_ENV: 'test',
    LOG_LEVEL: 'info',
    LOG_PRETTY_PRINT: false,
    ENABLE_PASSTHROUGH: true,
    MOCK_ON_ERROR: true,
    APOLLO_GRAPH_VARIANT: 'current',
    SCHEMA_CACHE_TTL_MS: 300000,
    SUBGRAPH_CHECK_INTERVAL_MS: 30000,
    SUBGRAPH_HEALTH_TIMEOUT_MS: 5000,
  },
  isDevelopment: () => false,
  isTest: () => true,
  isProduction: () => false,
  getPort: () => 3000,
  isPassthroughEnabled: () => true,
  shouldMockOnError: () => true,
}));
vi.mock('../../services/SchemaCache');
vi.mock('fs/promises');

const mockedFs = vi.mocked(fs);

describe('MockHandler', () => {
  let handler: MockHandler;
  let mockSchemaCache: SchemaCache;
  let mockGenerator: MockGenerator;
  const subgraphName = 'products';

  beforeEach(() => {
    mockSchemaCache = new SchemaCache({} as any);
    mockGenerator = new MockGenerator();
    handler = new MockHandler(mockSchemaCache, mockGenerator);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleRequest', () => {
    describe('successful mock generation', () => {
      it('should generate a mock response for a valid query', async () => {
        const req = createMockRequest({
          body: createGraphQLRequest(SAMPLE_QUERY, { id: '123' }),
        });
        const res = createMockResponse();

        const schema = buildSchema(SAMPLE_SCHEMA_SDL);
        const mockResponse = {
          data: {
            product: {
              id: '123',
              name: 'Mock Product',
              price: 99.99,
            },
          },
        };

        vi.spyOn(mockSchemaCache, 'getSchema').mockResolvedValue(schema);
        vi.spyOn(mockGenerator, 'generateMockResponseForSubgraph').mockResolvedValue(mockResponse);

        // Mock fs to simulate no mocks directory
        mockedFs.access.mockRejectedValue(new Error('ENOENT'));

        await handler.handleRequest(req, res, subgraphName);

        // Verify schema was retrieved
        expect(mockSchemaCache.getSchema).toHaveBeenCalledWith(subgraphName);

        // Verify mock was generated
        expect(mockGenerator.generateMockResponseForSubgraph).toHaveBeenCalledWith(
          subgraphName,
          schema,
          SAMPLE_QUERY,
          { id: '123' },
          undefined,
        );

        // Verify response headers
        expect(res.setHeader).toHaveBeenCalledWith('X-Mock-Response', 'true');
        expect(res.setHeader).toHaveBeenCalledWith('X-Mock-Subgraph', subgraphName);
        expect(res.setHeader).toHaveBeenCalledWith('X-Proxy-Mode', 'mock');

        // Verify response
        assertResponseSent(res, 200, mockResponse);
      });

      it('should handle queries with operation names', async () => {
        const operationName = 'GetProduct';
        const req = createMockRequest({
          body: createGraphQLRequest(SAMPLE_QUERY, { id: '456' }, operationName),
        });
        const res = createMockResponse();

        const schema = buildSchema(SAMPLE_SCHEMA_SDL);
        const mockResponse = { data: { product: { id: '456' } } };

        vi.spyOn(mockSchemaCache, 'getSchema').mockResolvedValue(schema);
        vi.spyOn(mockGenerator, 'generateMockResponseForSubgraph').mockResolvedValue(mockResponse);
        mockedFs.access.mockRejectedValue(new Error('ENOENT'));

        await handler.handleRequest(req, res, subgraphName);

        expect(mockGenerator.generateMockResponseForSubgraph).toHaveBeenCalledWith(
          subgraphName,
          schema,
          SAMPLE_QUERY,
          { id: '456' },
          operationName
        );
      });

      it('should handle queries without variables', async () => {
        const simpleQuery = 'query { products { id name } }';
        const req = createMockRequest({
          body: { query: simpleQuery },
        });
        const res = createMockResponse();

        const schema = buildSchema(SAMPLE_SCHEMA_SDL);
        const mockResponse = {
          data: {
            products: [
              { id: '1', name: 'Product 1' },
              { id: '2', name: 'Product 2' },
            ],
          },
        };

        vi.spyOn(mockSchemaCache, 'getSchema').mockResolvedValue(schema);
        vi.spyOn(mockGenerator, 'generateMockResponseForSubgraph').mockResolvedValue(mockResponse);
        mockedFs.access.mockRejectedValue(new Error('ENOENT'));

        await handler.handleRequest(req, res, subgraphName);

        expect(mockGenerator.generateMockResponseForSubgraph).toHaveBeenCalledWith(
          subgraphName,
          schema,
          simpleQuery,
          undefined,
          undefined,
        );
        assertResponseSent(res, 200, mockResponse);
      });

      it('should handle mocks directory not existing', async () => {
        const req = createMockRequest({
          body: createGraphQLRequest(SAMPLE_QUERY, { id: '123' }),
        });
        const res = createMockResponse();

        const schema = buildSchema(SAMPLE_SCHEMA_SDL);
        const mockResponse = {
          data: {
            product: {
              id: '123',
              name: 'Mock Product',
              price: 99.99,
            },
          },
        };

        vi.spyOn(mockSchemaCache, 'getSchema').mockResolvedValue(schema);
        vi.spyOn(mockGenerator, 'generateMockResponseForSubgraph').mockResolvedValue(mockResponse);

        // Mock fs to simulate no mocks directory
        mockedFs.access.mockRejectedValue(new Error('ENOENT'));

        await handler.handleRequest(req, res, subgraphName);

        // Should not set custom mock header when no mocks directory exists
        expect(res.setHeader).not.toHaveBeenCalledWith('X-Mock-Custom', 'true');
        assertResponseSent(res, 200, mockResponse);
      });
    });

    describe('validation errors', () => {
      it('should return 400 if no query is provided', async () => {
        const req = createMockRequest({
          body: {},
        });
        const res = createMockResponse();

        await handler.handleRequest(req, res, subgraphName);

        assertErrorResponse(res, 400, 'BAD_REQUEST');

        const responseData = (res.json as any).mock.calls[0][0];
        expect(responseData.errors[0].message).toBe('No query provided');
      });

      it('should return 400 if query is not a string', async () => {
        const req = createMockRequest({
          body: { query: 123 },
        });
        const res = createMockResponse();

        await handler.handleRequest(req, res, subgraphName);

        assertErrorResponse(res, 400, 'BAD_REQUEST');

        const responseData = (res.json as any).mock.calls[0][0];
        expect(responseData.errors[0].message).toBe('Query must be a string');
      });

      it('should return 400 if query is null', async () => {
        const req = createMockRequest({
          body: { query: null },
        });
        const res = createMockResponse();

        await handler.handleRequest(req, res, subgraphName);

        assertErrorResponse(res, 400, 'BAD_REQUEST');
      });

      it('should return 400 if query is an object', async () => {
        const req = createMockRequest({
          body: { query: { invalid: 'object' } },
        });
        const res = createMockResponse();

        await handler.handleRequest(req, res, subgraphName);

        assertErrorResponse(res, 400, 'BAD_REQUEST');
      });
    });

    describe('schema errors', () => {
      it('should return 404 if schema is not found', async () => {
        const req = createMockRequest({
          body: createGraphQLRequest(SAMPLE_QUERY),
        });
        const res = createMockResponse();

        vi.spyOn(mockSchemaCache, 'getSchema').mockRejectedValue(
          new Error('Schema not found')
        );
        mockedFs.access.mockRejectedValue(new Error('ENOENT'));

        await handler.handleRequest(req, res, subgraphName);

        assertErrorResponse(res, 404, 'SCHEMA_NOT_FOUND');

        const responseData = (res.json as any).mock.calls[0][0];
        expect(responseData.errors[0].extensions.subgraph).toBe(subgraphName);
      });

      it('should handle schema cache errors gracefully', async () => {
        const req = createMockRequest({
          body: createGraphQLRequest(SAMPLE_QUERY),
        });
        const res = createMockResponse();

        vi.spyOn(mockSchemaCache, 'getSchema').mockRejectedValue(
          new Error('Cache connection failed')
        );
        mockedFs.access.mockRejectedValue(new Error('ENOENT'));

        await handler.handleRequest(req, res, subgraphName);

        assertErrorResponse(res, 404, 'SCHEMA_NOT_FOUND');
      });
    });

    describe('mock generation errors', () => {
      it('should handle GraphQL parse errors', async () => {
        const req = createMockRequest({
          body: createGraphQLRequest('invalid query {'),
        });
        const res = createMockResponse();

        const schema = buildSchema(SAMPLE_SCHEMA_SDL);
        vi.spyOn(mockSchemaCache, 'getSchema').mockResolvedValue(schema);
        vi.spyOn(mockGenerator, 'generateMockResponseForSubgraph').mockRejectedValue(
          new Error('Failed to parse query')
        );
        mockedFs.access.mockRejectedValue(new Error('ENOENT'));

        await handler.handleRequest(req, res, subgraphName);

        assertErrorResponse(res, 400, 'GRAPHQL_PARSE_ERROR');
      });

      it('should handle GraphQL validation errors', async () => {
        const req = createMockRequest({
          body: createGraphQLRequest('query { invalidField }'),
        });
        const res = createMockResponse();

        const schema = buildSchema(SAMPLE_SCHEMA_SDL);
        vi.spyOn(mockSchemaCache, 'getSchema').mockResolvedValue(schema);
        vi.spyOn(mockGenerator, 'generateMockResponseForSubgraph').mockRejectedValue(
          new Error('Query validation failed for field invalidField')
        );
        mockedFs.access.mockRejectedValue(new Error('ENOENT'));

        await handler.handleRequest(req, res, subgraphName);

        assertErrorResponse(res, 400, 'GRAPHQL_VALIDATION_ERROR');
      });

      it('should handle schema processing errors', async () => {
        const req = createMockRequest({
          body: createGraphQLRequest(SAMPLE_QUERY),
        });
        const res = createMockResponse();

        const schema = buildSchema(SAMPLE_SCHEMA_SDL);
        vi.spyOn(mockSchemaCache, 'getSchema').mockResolvedValue(schema);
        vi.spyOn(mockGenerator, 'generateMockResponseForSubgraph').mockRejectedValue(
          new Error('schema is invalid')
        );
        mockedFs.access.mockRejectedValue(new Error('ENOENT'));

        await handler.handleRequest(req, res, subgraphName);

        assertErrorResponse(res, 500, 'SCHEMA_ERROR');
      });

      it('should handle generic mock generation errors', async () => {
        const req = createMockRequest({
          body: createGraphQLRequest(SAMPLE_QUERY),
        });
        const res = createMockResponse();

        const schema = buildSchema(SAMPLE_SCHEMA_SDL);
        vi.spyOn(mockSchemaCache, 'getSchema').mockResolvedValue(schema);
        vi.spyOn(mockGenerator, 'generateMockResponseForSubgraph').mockRejectedValue(
          new Error('Unknown error')
        );
        mockedFs.access.mockRejectedValue(new Error('ENOENT'));

        await handler.handleRequest(req, res, subgraphName);

        assertErrorResponse(res, 500, 'MOCK_GENERATION_ERROR');
      });
    });

    describe('custom mocks loading', () => {
      it('should call generateMockResponseForSubgraph with correct parameters', async () => {
        const req = createMockRequest({
          body: createGraphQLRequest(SAMPLE_QUERY),
        });
        const res = createMockResponse();

        const schema = buildSchema(SAMPLE_SCHEMA_SDL);
        vi.spyOn(mockSchemaCache, 'getSchema').mockResolvedValue(schema);
        vi.spyOn(mockGenerator, 'generateMockResponseForSubgraph').mockResolvedValue({
          data: {},
        });

        mockedFs.access.mockRejectedValue(new Error('ENOENT'));

        await handler.handleRequest(req, res, subgraphName);

        // Verify generateMockResponseForSubgraph was called with correct parameters
        expect(mockGenerator.generateMockResponseForSubgraph).toHaveBeenCalledWith(
          subgraphName,
          schema,
          SAMPLE_QUERY,
          undefined,
          undefined
        );
      });

      it('should call generateMockResponseForSubgraph for multiple requests', async () => {
        const req1 = createMockRequest({
          body: createGraphQLRequest(SAMPLE_QUERY),
        });
        const req2 = createMockRequest({
          body: createGraphQLRequest(SAMPLE_QUERY),
        });
        const res1 = createMockResponse();
        const res2 = createMockResponse();

        const schema = buildSchema(SAMPLE_SCHEMA_SDL);
        vi.spyOn(mockSchemaCache, 'getSchema').mockResolvedValue(schema);
        vi.spyOn(mockGenerator, 'generateMockResponseForSubgraph').mockResolvedValue({
          data: {},
        });

        mockedFs.access.mockRejectedValue(new Error('ENOENT'));

        await handler.handleRequest(req1, res1, subgraphName);
        await handler.handleRequest(req2, res2, subgraphName);

        // Should be called for each request
        expect(mockGenerator.generateMockResponseForSubgraph).toHaveBeenCalledTimes(2);
      });

      it('should handle errors when checking mocks directory gracefully', async () => {
        const req = createMockRequest({
          body: createGraphQLRequest(SAMPLE_QUERY),
        });
        const res = createMockResponse();

        const schema = buildSchema(SAMPLE_SCHEMA_SDL);
        vi.spyOn(mockSchemaCache, 'getSchema').mockResolvedValue(schema);
        vi.spyOn(mockGenerator, 'generateMockResponseForSubgraph').mockResolvedValue({
          data: {},
        });

        // Simulate a different kind of error
        mockedFs.access.mockRejectedValue(new Error('Permission denied'));

        // Should not throw, should handle gracefully
        await expect(handler.handleRequest(req, res, subgraphName)).resolves.not.toThrow();
        assertResponseSent(res, 200);
      });
    });

    describe('utility methods', () => {
      it('should return empty array when no custom mocks are loaded', () => {
        const loadedSubgraphs = handler.getLoadedMockSubgraphs();
        expect(Array.isArray(loadedSubgraphs)).toBe(true);
        expect(loadedSubgraphs).toHaveLength(0);
      });

    });

    describe('federation introspection queries', () => {
      const introspectionQuery = `
        query SubgraphIntrospectQuery {
          _service {
            sdl
          }
        }
      `;

      it('should return SDL for introspection query', async () => {
        const req = createMockRequest({
          body: { query: introspectionQuery },
        });
        const res = createMockResponse();

        const schema = buildSchema(SAMPLE_SCHEMA_SDL);
        vi.spyOn(mockSchemaCache, 'getSchema').mockResolvedValue(schema);

        await handler.handleRequest(req, res, subgraphName);

        expect(mockSchemaCache.getSchema).toHaveBeenCalledWith(subgraphName);
        expect(res.setHeader).toHaveBeenCalledWith('X-Mock-Response', 'true');
        expect(res.setHeader).toHaveBeenCalledWith('X-Mock-Subgraph', subgraphName);
        expect(res.setHeader).toHaveBeenCalledWith('X-Proxy-Mode', 'mock-introspection');

        assertResponseSent(res, 200);
        const responseData = (res.json as any).mock.calls[0][0];
        expect(responseData.data._service).toBeDefined();
        expect(responseData.data._service.sdl).toBeDefined();
        expect(responseData.data._service.sdl).toContain('type Product');
      });

      it('should handle introspection query with different formatting', async () => {
        const formattedQuery = 'query SubgraphIntrospectQuery{_service{sdl}}';
        const req = createMockRequest({
          body: { query: formattedQuery },
        });
        const res = createMockResponse();

        const schema = buildSchema(SAMPLE_SCHEMA_SDL);
        vi.spyOn(mockSchemaCache, 'getSchema').mockResolvedValue(schema);

        await handler.handleRequest(req, res, subgraphName);

        expect(mockSchemaCache.getSchema).toHaveBeenCalledWith(subgraphName);
        assertResponseSent(res, 200);
        const responseData = (res.json as any).mock.calls[0][0];
        expect(responseData.data._service.sdl).toBeDefined();
      });

      it('should handle introspection query with comments and whitespace', async () => {
        const queryWithComments = `
          query SubgraphIntrospectQuery {
            # eslint-disable-next-line
            _service {
              sdl
            }
          }
        `;
        const req = createMockRequest({
          body: { query: queryWithComments },
        });
        const res = createMockResponse();

        const schema = buildSchema(SAMPLE_SCHEMA_SDL);
        vi.spyOn(mockSchemaCache, 'getSchema').mockResolvedValue(schema);

        await handler.handleRequest(req, res, subgraphName);

        expect(mockSchemaCache.getSchema).toHaveBeenCalledWith(subgraphName);
        assertResponseSent(res, 200);
        const responseData = (res.json as any).mock.calls[0][0];
        expect(responseData.data._service.sdl).toBeDefined();
      });

      it('should return 404 if schema not found for introspection', async () => {
        const req = createMockRequest({
          body: { query: introspectionQuery },
        });
        const res = createMockResponse();

        vi.spyOn(mockSchemaCache, 'getSchema').mockRejectedValue(new Error('Schema not found'));

        await handler.handleRequest(req, res, subgraphName);

        assertErrorResponse(res, 404, 'SCHEMA_NOT_FOUND');
        const responseData = (res.json as any).mock.calls[0][0];
        expect(responseData.errors[0].message).toContain('Schema not found');
        expect(responseData.errors[0].extensions.subgraph).toBe(subgraphName);
      });
    });
  });
});
