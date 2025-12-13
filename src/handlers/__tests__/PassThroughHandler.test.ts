import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PassThroughHandler } from '../../../src/handlers/PassThroughHandler';
import { SchemaCache } from '../../../src/services/SchemaCache';
import axios, { AxiosError } from 'axios';
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

// Mock axios
vi.mock('axios');
const mockedAxios = vi.mocked(axios);

// Mock SchemaCache
vi.mock('../../../src/services/SchemaCache');

describe('PassThroughHandler', () => {
  let handler: PassThroughHandler;
  let mockSchemaCache: SchemaCache;
  const targetUrl = 'http://test-subgraph.example.com/graphql';
  const subgraphName = 'products';

  beforeEach(() => {
    mockSchemaCache = new SchemaCache({} as any);
    handler = new PassThroughHandler(mockSchemaCache);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleRequest', () => {
    describe('successful requests', () => {
      it('should forward a GraphQL request to the target URL', async () => {
        const req = createMockRequest({
          body: createGraphQLRequest(SAMPLE_QUERY, { id: '123' }),
          headers: {
            'content-type': 'application/json',
            'authorization': 'Bearer token123',
          },
        });
        const res = createMockResponse();

        const mockResponse = {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'cache-control': 'max-age=3600',
          },
          data: {
            data: {
              product: {
                id: '123',
                name: 'Test Product',
                price: 29.99,
              },
            },
          },
        };

        mockedAxios.post.mockResolvedValue(mockResponse);

        await handler.handleRequest(req, res, targetUrl);

        // Verify axios was called correctly
        expect(mockedAxios.post).toHaveBeenCalledWith(
          targetUrl,
          req.body,
          expect.objectContaining({
            headers: expect.objectContaining({
              'content-type': 'application/json',
              'authorization': 'Bearer token123',
            }),
            timeout: 30000,
            validateStatus: expect.any(Function),
          })
        );

        // Verify response headers were set
        expect(res.setHeader).toHaveBeenCalledWith('content-type', 'application/json');
        expect(res.setHeader).toHaveBeenCalledWith('cache-control', 'max-age=3600');
        expect(res.setHeader).toHaveBeenCalledWith('X-Proxy-Mode', 'passthrough');
        expect(res.setHeader).toHaveBeenCalledWith('X-Proxy-Target', targetUrl);

        // Verify response was sent
        assertResponseSent(res, 200, mockResponse.data);
      });

      it('should handle custom timeout parameter', async () => {
        const req = createMockRequest({
          body: createGraphQLRequest(SAMPLE_QUERY),
        });
        const res = createMockResponse();
        const customTimeout = 5000;

        mockedAxios.post.mockResolvedValue({
          status: 200,
          headers: {},
          data: { data: {} },
        });

        await handler.handleRequest(req, res, targetUrl, customTimeout);

        expect(mockedAxios.post).toHaveBeenCalledWith(
          targetUrl,
          req.body,
          expect.objectContaining({
            timeout: customTimeout,
          })
        );
      });

      it('should forward multiple request headers', async () => {
        const req = createMockRequest({
          body: createGraphQLRequest(SAMPLE_QUERY),
          headers: {
            'content-type': 'application/json',
            'authorization': 'Bearer token',
            'x-api-key': 'api-key-123',
            'x-request-id': 'req-456',
            'user-agent': 'test-client',
          },
        });
        const res = createMockResponse();

        mockedAxios.post.mockResolvedValue({
          status: 200,
          headers: {},
          data: { data: {} },
        });

        await handler.handleRequest(req, res, targetUrl);

        const calledHeaders = mockedAxios.post.mock.calls[0][2]?.headers;
        expect(calledHeaders).toHaveProperty('content-type');
        expect(calledHeaders).toHaveProperty('authorization');
        expect(calledHeaders).toHaveProperty('x-api-key');
        expect(calledHeaders).toHaveProperty('x-request-id');
        expect(calledHeaders).toHaveProperty('user-agent');
      });

      it('should handle array header values', async () => {
        const contentTypeHeader = ['application/json', 'charset=utf-8'] as any;
        const req = createMockRequest({
          body: createGraphQLRequest(SAMPLE_QUERY),
          headers: {
            'content-type': contentTypeHeader,
          },
        });
        const res = createMockResponse();

        mockedAxios.post.mockResolvedValue({
          status: 200,
          headers: {},
          data: { data: {} },
        });

        await handler.handleRequest(req, res, targetUrl);

        const calledHeaders = mockedAxios.post.mock.calls[0][2]?.headers;
        expect(calledHeaders?.['content-type']).toBe(contentTypeHeader);
      });

      it('should forward non-200 status codes from subgraph', async () => {
        const req = createMockRequest({
          body: createGraphQLRequest(SAMPLE_QUERY),
        });
        const res = createMockResponse();

        const mockResponse = {
          status: 400,
          headers: {
            'content-type': 'application/json',
          },
          data: {
            errors: [
              {
                message: 'Bad request from subgraph',
              },
            ],
          },
        };

        mockedAxios.post.mockResolvedValue(mockResponse);

        await handler.handleRequest(req, res, targetUrl);

        assertResponseSent(res, 400, mockResponse.data);
      });

      it('should only forward allowed response headers', async () => {
        const req = createMockRequest({
          body: createGraphQLRequest(SAMPLE_QUERY),
        });
        const res = createMockResponse();

        const mockResponse = {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'cache-control': 'no-cache',
            'etag': '"abc123"',
            'x-cache-status': 'HIT',
            'server': 'nginx', // Should not be forwarded
            'x-powered-by': 'Express', // Should not be forwarded
          },
          data: { data: {} },
        };

        mockedAxios.post.mockResolvedValue(mockResponse);

        await handler.handleRequest(req, res, targetUrl);

        for (const [key, value] of Object.entries(mockResponse.headers)) {
          expect(res.setHeader).toHaveBeenCalledWith(key, value);
        }

      });
    });

    describe('error handling', () => {
      it('should handle timeout errors', async () => {
        const req = createMockRequest({
          body: createGraphQLRequest(SAMPLE_QUERY),
        });
        const res = createMockResponse();

        const timeoutError = new Error('timeout of 30000ms exceeded') as AxiosError;
        timeoutError.code = 'ECONNABORTED';
        Object.setPrototypeOf(timeoutError, AxiosError.prototype);
        mockedAxios.isAxiosError.mockReturnValue(true);
        mockedAxios.post.mockRejectedValue(timeoutError);

        await handler.handleRequest(req, res, targetUrl);

        assertErrorResponse(res, 504, 'GATEWAY_TIMEOUT');

        const responseData = (res.json as any).mock.calls[0][0];
        expect(responseData.errors[0].extensions.timeout).toBe(true);
        expect(responseData.errors[0].extensions.target).toBe(targetUrl);
      });

      it('should handle connection refused errors', async () => {
        const req = createMockRequest({
          body: createGraphQLRequest(SAMPLE_QUERY),
        });
        const res = createMockResponse();

        const connError = new Error('connect ECONNREFUSED') as AxiosError;
        connError.code = 'ECONNREFUSED';
        Object.setPrototypeOf(connError, AxiosError.prototype);
        mockedAxios.isAxiosError.mockReturnValue(true);
        mockedAxios.post.mockRejectedValue(connError);

        await handler.handleRequest(req, res, targetUrl);

        assertErrorResponse(res, 503, 'SERVICE_UNAVAILABLE');

        const responseData = (res.json as any).mock.calls[0][0];
        expect(responseData.errors[0].extensions.errorCode).toBe('ECONNREFUSED');
      });

      it('should handle DNS resolution errors', async () => {
        const req = createMockRequest({
          body: createGraphQLRequest(SAMPLE_QUERY),
        });
        const res = createMockResponse();

        const dnsError = new Error('getaddrinfo ENOTFOUND') as AxiosError;
        dnsError.code = 'ENOTFOUND';
        Object.setPrototypeOf(dnsError, AxiosError.prototype);
        mockedAxios.isAxiosError.mockReturnValue(true);
        mockedAxios.post.mockRejectedValue(dnsError);

        await handler.handleRequest(req, res, targetUrl);

        assertErrorResponse(res, 503, 'SERVICE_UNAVAILABLE');

        const responseData = (res.json as any).mock.calls[0][0];
        expect(responseData.errors[0].extensions.errorCode).toBe('ENOTFOUND');
      });

      it('should handle network errors without response', async () => {
        const req = createMockRequest({
          body: createGraphQLRequest(SAMPLE_QUERY),
        });
        const res = createMockResponse();

        const networkError = new Error('Network Error') as AxiosError;
        networkError.code = 'ERR_NETWORK';
        Object.setPrototypeOf(networkError, AxiosError.prototype);
        mockedAxios.isAxiosError.mockReturnValue(true);
        mockedAxios.post.mockRejectedValue(networkError);

        await handler.handleRequest(req, res, targetUrl);

        assertErrorResponse(res, 502, 'BAD_GATEWAY');
      });

      it('should handle non-axios errors', async () => {
        const req = createMockRequest({
          body: createGraphQLRequest(SAMPLE_QUERY),
        });
        const res = createMockResponse();

        const genericError = new Error('Something went wrong');
        mockedAxios.isAxiosError.mockReturnValue(false);
        mockedAxios.post.mockRejectedValue(genericError);

        await handler.handleRequest(req, res, targetUrl);

        assertErrorResponse(res, 500, 'INTERNAL_SERVER_ERROR');
      });
    });

    describe('edge cases', () => {
      it('should handle empty request body', async () => {
        const req = createMockRequest({
          body: {},
        });
        const res = createMockResponse();

        mockedAxios.post.mockResolvedValue({
          status: 200,
          headers: {},
          data: { data: null },
        });

        await handler.handleRequest(req, res, targetUrl);

        expect(mockedAxios.post).toHaveBeenCalledWith(
          targetUrl,
          {},
          expect.any(Object)
        );
      });

      it('should handle missing headers', async () => {
        const req = createMockRequest({
          body: createGraphQLRequest(SAMPLE_QUERY),
          headers: {},
        });
        const res = createMockResponse();

        mockedAxios.post.mockResolvedValue({
          status: 200,
          headers: {},
          data: { data: {} },
        });

        await handler.handleRequest(req, res, targetUrl);

        const calledHeaders = mockedAxios.post.mock.calls[0][2]?.headers;
        // Should be an empty or minimal headers object
        expect(Object.keys(calledHeaders || {}).length).toBeLessThanOrEqual(1);
      });

      it('should handle response without headers', async () => {
        const req = createMockRequest({
          body: createGraphQLRequest(SAMPLE_QUERY),
        });
        const res = createMockResponse();

        mockedAxios.post.mockResolvedValue({
          status: 200,
          headers: {},
          data: { data: {} },
        });

        await handler.handleRequest(req, res, targetUrl);

        // Should still set our custom headers
        expect(res.setHeader).toHaveBeenCalledWith('X-Proxy-Mode', 'passthrough');
        expect(res.setHeader).toHaveBeenCalledWith('X-Proxy-Target', targetUrl);
        assertResponseSent(res, 200);
      });

      it('should handle very large response bodies', async () => {
        const req = createMockRequest({
          body: createGraphQLRequest(SAMPLE_QUERY),
        });
        const res = createMockResponse();

        // Create a large response
        const largeArray = Array(1000).fill(null).map((_, i) => ({
          id: `${i}`,
          name: `Product ${i}`,
          description: 'A'.repeat(500),
        }));

        const mockResponse = {
          status: 200,
          headers: { 'content-type': 'application/json' },
          data: { data: { products: largeArray } },
        };

        mockedAxios.post.mockResolvedValue(mockResponse);

        await handler.handleRequest(req, res, targetUrl);

        assertResponseSent(res, 200, mockResponse.data);
      });

      it('should handle URLs with special characters', async () => {
        const specialUrl = 'http://test.example.com/graphql?param=value&other=123';
        const req = createMockRequest({
          body: createGraphQLRequest(SAMPLE_QUERY),
        });
        const res = createMockResponse();

        mockedAxios.post.mockResolvedValue({
          status: 200,
          headers: {},
          data: { data: {} },
        });

        await handler.handleRequest(req, res, specialUrl);

        expect(mockedAxios.post).toHaveBeenCalledWith(
          specialUrl,
          expect.any(Object),
          expect.any(Object)
        );
      });

      it('should preserve Apollo-specific headers', async () => {
        const req = createMockRequest({
          body: createGraphQLRequest(SAMPLE_QUERY),
          headers: {
            'apollographql-client-name': 'test-client',
            'apollographql-client-version': '1.0.0',
          },
        });
        const res = createMockResponse();

        mockedAxios.post.mockResolvedValue({
          status: 200,
          headers: {
            'apollographql-cache-metadata': 'max-age=3600',
          },
          data: { data: {} },
        });

        await handler.handleRequest(req, res, targetUrl);

        const calledHeaders = mockedAxios.post.mock.calls[0][2]?.headers;
        expect(calledHeaders).toHaveProperty('apollographql-client-name');
        expect(calledHeaders).toHaveProperty('apollographql-client-version');

        expect(res.setHeader).toHaveBeenCalledWith(
          'apollographql-cache-metadata',
          'max-age=3600'
        );
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

      it('should passthrough introspection query when subgraph is available', async () => {
        const req = createMockRequest({
          body: { query: introspectionQuery },
        });
        const res = createMockResponse();

        const mockResponse = {
          status: 200,
          headers: {},
          data: {
            data: {
              _service: {
                sdl: 'type Query { test: String }',
              },
            },
          },
        };

        mockedAxios.post.mockResolvedValue(mockResponse);

        await handler.handleRequest(req, res, targetUrl, 30000, subgraphName);

        // Should pass through to the actual subgraph
        expect(mockedAxios.post).toHaveBeenCalled();
        expect(res.setHeader).toHaveBeenCalledWith('X-Proxy-Mode', 'passthrough');
        assertResponseSent(res, 200, mockResponse.data);
      });

      it('should return cached SDL when subgraph is unavailable for introspection', async () => {
        const req = createMockRequest({
          body: { query: introspectionQuery },
        });
        const res = createMockResponse();

        const connError = new Error('connect ECONNREFUSED') as AxiosError;
        connError.code = 'ECONNREFUSED';
        Object.setPrototypeOf(connError, AxiosError.prototype);
        mockedAxios.isAxiosError.mockReturnValue(true);
        mockedAxios.post.mockRejectedValue(connError);

        const schema = buildSchema(SAMPLE_SCHEMA_SDL);
        vi.spyOn(mockSchemaCache, 'getSchema').mockResolvedValue(schema);

        await handler.handleRequest(req, res, targetUrl, 30000, subgraphName);

        // Should have tried passthrough first
        expect(mockedAxios.post).toHaveBeenCalled();
        // Then fallen back to cache
        expect(mockSchemaCache.getSchema).toHaveBeenCalledWith(subgraphName);
        expect(res.setHeader).toHaveBeenCalledWith('X-Proxy-Mode', 'passthrough-introspection-cached');
        expect(res.setHeader).toHaveBeenCalledWith('X-Cache-Fallback', 'true');
        assertResponseSent(res, 200);
        const responseData = (res.json as any).mock.calls[0][0];
        expect(responseData.data._service.sdl).toContain('type Product');
      });

      it('should return cached SDL for timeout errors on introspection', async () => {
        const req = createMockRequest({
          body: { query: introspectionQuery },
        });
        const res = createMockResponse();

        const timeoutError = new Error('timeout of 30000ms exceeded') as AxiosError;
        timeoutError.code = 'ECONNABORTED';
        Object.setPrototypeOf(timeoutError, AxiosError.prototype);
        mockedAxios.isAxiosError.mockReturnValue(true);
        mockedAxios.post.mockRejectedValue(timeoutError);

        const schema = buildSchema(SAMPLE_SCHEMA_SDL);
        vi.spyOn(mockSchemaCache, 'getSchema').mockResolvedValue(schema);

        await handler.handleRequest(req, res, targetUrl, 30000, subgraphName);

        expect(mockSchemaCache.getSchema).toHaveBeenCalledWith(subgraphName);
        expect(res.setHeader).toHaveBeenCalledWith('X-Cache-Fallback', 'true');
        assertResponseSent(res, 200);
      });

      it('should return normal error for non-introspection queries when subgraph unavailable', async () => {
        const req = createMockRequest({
          body: createGraphQLRequest(SAMPLE_QUERY),
        });
        const res = createMockResponse();

        const connError = new Error('connect ECONNREFUSED') as AxiosError;
        connError.code = 'ECONNREFUSED';
        Object.setPrototypeOf(connError, AxiosError.prototype);
        mockedAxios.isAxiosError.mockReturnValue(true);
        mockedAxios.post.mockRejectedValue(connError);

        await handler.handleRequest(req, res, targetUrl, 30000, subgraphName);

        // Should return error, not cached SDL
        assertErrorResponse(res, 503, 'SERVICE_UNAVAILABLE');
      });

      it('should return normal error if cache fails for unavailable introspection', async () => {
        const req = createMockRequest({
          body: { query: introspectionQuery },
        });
        const res = createMockResponse();

        const connError = new Error('connect ECONNREFUSED') as AxiosError;
        connError.code = 'ECONNREFUSED';
        Object.setPrototypeOf(connError, AxiosError.prototype);
        mockedAxios.isAxiosError.mockReturnValue(true);
        mockedAxios.post.mockRejectedValue(connError);

        vi.spyOn(mockSchemaCache, 'getSchema').mockRejectedValue(new Error('Schema not found'));

        await handler.handleRequest(req, res, targetUrl, 30000, subgraphName);

        // Should have tried cache but failed, so return normal error
        expect(mockSchemaCache.getSchema).toHaveBeenCalledWith(subgraphName);
        assertErrorResponse(res, 503, 'SERVICE_UNAVAILABLE');
      });
    });

    describe('sanitizeHeaders', () => {
      it('should remove hop-by-hop headers', () => {
        const headers = {
          'content-type': 'application/json',
          'authorization': 'Bearer token',
          'connection': 'keep-alive',
          'keep-alive': 'timeout=5',
          'proxy-authenticate': 'Basic',
          'proxy-authorization': 'Bearer proxy-token',
          'te': 'trailers',
          'trailer': 'Expires',
          'transfer-encoding': 'chunked',
          'upgrade': 'websocket',
        };

        const sanitized = handler.sanitizeHeaders(headers);

        // Should keep safe headers
        expect(sanitized).toHaveProperty('content-type', 'application/json');
        expect(sanitized).toHaveProperty('authorization', 'Bearer token');

        // Should remove hop-by-hop headers
        expect(sanitized).not.toHaveProperty('connection');
        expect(sanitized).not.toHaveProperty('keep-alive');
        expect(sanitized).not.toHaveProperty('proxy-authenticate');
        expect(sanitized).not.toHaveProperty('proxy-authorization');
        expect(sanitized).not.toHaveProperty('te');
        expect(sanitized).not.toHaveProperty('trailer');
        expect(sanitized).not.toHaveProperty('transfer-encoding');
        expect(sanitized).not.toHaveProperty('upgrade');
      });

      it('should remove non-proxyable headers', () => {
        const headers = {
          'content-type': 'application/json',
          'authorization': 'Bearer token',
          'host': 'old-server.com',
          'content-length': '1234',
          'content-encoding': 'gzip',
        };

        const sanitized = handler.sanitizeHeaders(headers);

        // Should keep safe headers
        expect(sanitized).toHaveProperty('content-type', 'application/json');
        expect(sanitized).toHaveProperty('authorization', 'Bearer token');

        // Should remove non-proxyable headers
        expect(sanitized).not.toHaveProperty('host');
        expect(sanitized).not.toHaveProperty('content-length');
        expect(sanitized).not.toHaveProperty('content-encoding');
      });

      it('should handle case-insensitive header names', () => {
        const headers = {
          'Content-Type': 'application/json',
          'AUTHORIZATION': 'Bearer token',
          'Connection': 'keep-alive',
          'HOST': 'old-server.com',
          'Content-Length': '1234',
        };

        const sanitized = handler.sanitizeHeaders(headers);

        // Should keep safe headers (preserving original case)
        expect(sanitized).toHaveProperty('Content-Type', 'application/json');
        expect(sanitized).toHaveProperty('AUTHORIZATION', 'Bearer token');

        // Should remove headers regardless of case
        expect(sanitized).not.toHaveProperty('Connection');
        expect(sanitized).not.toHaveProperty('HOST');
        expect(sanitized).not.toHaveProperty('Content-Length');
      });

      it('should preserve array header values', () => {
        const headers = {
          'content-type': ['application/json', 'charset=utf-8'],
          'accept': ['application/json', 'text/html'],
          'connection': ['keep-alive', 'close'],
        };

        const sanitized = handler.sanitizeHeaders(headers);

        // Should keep safe headers with array values
        expect(sanitized['content-type']).toEqual(['application/json', 'charset=utf-8']);
        expect(sanitized['accept']).toEqual(['application/json', 'text/html']);

        // Should remove hop-by-hop headers even with array values
        expect(sanitized).not.toHaveProperty('connection');
      });

      it('should handle undefined header values', () => {
        const headers = {
          'content-type': 'application/json',
          'authorization': undefined,
          'x-custom-header': 'value',
          'connection': undefined,
        };

        const sanitized = handler.sanitizeHeaders(headers);

        // Should keep defined safe headers
        expect(sanitized).toHaveProperty('content-type', 'application/json');
        expect(sanitized).toHaveProperty('x-custom-header', 'value');

        // Should skip undefined values
        expect(sanitized).not.toHaveProperty('authorization');
        expect(sanitized).not.toHaveProperty('connection');
      });

      it('should preserve custom and Apollo headers', () => {
        const headers = {
          'content-type': 'application/json',
          'apollographql-client-name': 'test-client',
          'apollographql-client-version': '1.0.0',
          'x-api-key': 'api-key-123',
          'x-request-id': 'req-456',
          'user-agent': 'Mozilla/5.0',
          'accept': 'application/json',
          'accept-encoding': 'gzip, deflate',
          'accept-language': 'en-US,en;q=0.9',
        };

        const sanitized = handler.sanitizeHeaders(headers);

        // All these headers should be preserved
        expect(sanitized).toHaveProperty('content-type');
        expect(sanitized).toHaveProperty('apollographql-client-name');
        expect(sanitized).toHaveProperty('apollographql-client-version');
        expect(sanitized).toHaveProperty('x-api-key');
        expect(sanitized).toHaveProperty('x-request-id');
        expect(sanitized).toHaveProperty('user-agent');
        expect(sanitized).toHaveProperty('accept');
        expect(sanitized).toHaveProperty('accept-encoding');
        expect(sanitized).toHaveProperty('accept-language');
      });

      it('should handle empty headers object', () => {
        const headers = {};

        const sanitized = handler.sanitizeHeaders(headers);

        expect(sanitized).toEqual({});
      });

      it('should handle headers with only hop-by-hop headers', () => {
        const headers = {
          'connection': 'keep-alive',
          'keep-alive': 'timeout=5',
          'transfer-encoding': 'chunked',
        };

        const sanitized = handler.sanitizeHeaders(headers);

        expect(sanitized).toEqual({});
      });

      it('should preserve cache-control and etag headers', () => {
        const headers = {
          'cache-control': 'max-age=3600, public',
          'etag': '"abc123"',
          'last-modified': 'Wed, 21 Oct 2024 07:28:00 GMT',
          'expires': 'Thu, 01 Jan 2025 00:00:00 GMT',
        };

        const sanitized = handler.sanitizeHeaders(headers);

        // All cache-related headers should be preserved
        expect(sanitized).toHaveProperty('cache-control');
        expect(sanitized).toHaveProperty('etag');
        expect(sanitized).toHaveProperty('last-modified');
        expect(sanitized).toHaveProperty('expires');
      });

      it('should preserve authentication headers', () => {
        const headers = {
          'authorization': 'Bearer token123',
          'cookie': 'session=abc123',
          'www-authenticate': 'Bearer realm="example"',
        };

        const sanitized = handler.sanitizeHeaders(headers);

        // Authentication headers should be preserved
        expect(sanitized).toHaveProperty('authorization');
        expect(sanitized).toHaveProperty('cookie');
        expect(sanitized).toHaveProperty('www-authenticate');
      });

      it('should handle mixed valid and invalid headers', () => {
        const headers = {
          'content-type': 'application/json',
          'authorization': 'Bearer token',
          'connection': 'keep-alive',
          'x-custom-header': 'custom-value',
          'host': 'old-host.com',
          'cache-control': 'no-cache',
          'transfer-encoding': 'chunked',
          'user-agent': 'test-agent',
        };

        const sanitized = handler.sanitizeHeaders(headers);

        // Should keep valid headers
        expect(Object.keys(sanitized)).toEqual(
          expect.arrayContaining(['content-type', 'authorization', 'x-custom-header', 'cache-control', 'user-agent'])
        );

        // Should remove invalid headers
        expect(sanitized).not.toHaveProperty('connection');
        expect(sanitized).not.toHaveProperty('host');
        expect(sanitized).not.toHaveProperty('transfer-encoding');

      });
    });
  });
});
