import { describe, it, expect, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { GraphQLError } from 'graphql';
import {
  ProxyError,
  ErrorCodes,
  errorHandler,
  asyncHandler,
  notFoundHandler,
} from '../../../src/middleware/errorHandler';

/**
 * Error Handler Middleware Tests
 *
 * Tests error handling, formatting, and response generation.
 */

function createMockReq(options: Partial<Request> = {}): Partial<Request> {
  return {
    method: 'POST',
    url: '/test',
    headers: {},
    ...options,
  };
}

function createMockRes(): any {
  const res: any = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    headersSent: false,
    getHeader: vi.fn(),
  };
  return res;
}

describe('Error Handler Middleware', () => {
  describe('ProxyError class', () => {
    it('should create error with message and code', () => {
      const error = new ProxyError('Test error', 'TEST_CODE');

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.statusCode).toBe(500); // default
      expect(error.extensions).toEqual({});
    });

    it('should create error with custom status code', () => {
      const error = new ProxyError('Not found', 'NOT_FOUND', 404);

      expect(error.statusCode).toBe(404);
    });

    it('should create error with extensions', () => {
      const extensions = { subgraph: 'orders', url: 'http://orders:4001' };
      const error = new ProxyError('Subgraph error', 'SUBGRAPH_ERROR', 503, extensions);

      expect(error.extensions).toEqual(extensions);
    });

    it('should be instance of Error', () => {
      const error = new ProxyError('Test');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ProxyError);
    });

    it('should have proper name', () => {
      const error = new ProxyError('Test');
      expect(error.name).toBe('ProxyError');
    });
  });

  describe('ErrorCodes constants', () => {
    it('should have all required error codes', () => {
      expect(ErrorCodes.INVALID_URL).toBe('INVALID_URL');
      expect(ErrorCodes.INVALID_GRAPHQL_REQUEST).toBe('INVALID_GRAPHQL_REQUEST');
      expect(ErrorCodes.MISSING_QUERY).toBe('MISSING_QUERY');
      expect(ErrorCodes.SUBGRAPH_NOT_FOUND).toBe('SUBGRAPH_NOT_FOUND');
      expect(ErrorCodes.SUBGRAPH_UNAVAILABLE).toBe('SUBGRAPH_UNAVAILABLE');
      expect(ErrorCodes.SCHEMA_FETCH_FAILED).toBe('SCHEMA_FETCH_FAILED');
      expect(ErrorCodes.MOCK_GENERATION_ERROR).toBe('MOCK_GENERATION_ERROR');
      expect(ErrorCodes.PASSTHROUGH_FAILED).toBe('PASSTHROUGH_FAILED');
      expect(ErrorCodes.INTERNAL_SERVER_ERROR).toBe('INTERNAL_SERVER_ERROR');
    });
  });

  describe('errorHandler middleware', () => {
    it('should handle ProxyError correctly', () => {
      const error = new ProxyError('Test error', 'TEST_CODE', 400);
      const req = createMockReq() as Request;
      const res = createMockRes();
      const next = vi.fn();

      errorHandler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalled();

      const response = res.json.mock.calls[0][0];
      expect(response.errors).toHaveLength(1);
      expect(response.errors[0].message).toBe('Test error');
      expect(response.errors[0].extensions.code).toBe('TEST_CODE');
      expect(response.data).toBe(null);
    });

    it('should handle GraphQLError correctly', () => {
      const error = new GraphQLError('GraphQL error', {
        extensions: { code: 'GRAPHQL_ERROR' },
      });
      const req = createMockReq() as Request;
      const res = createMockRes();
      const next = vi.fn();

      errorHandler(error, req, res, next);

      expect(res.json).toHaveBeenCalled();
      const response = res.json.mock.calls[0][0];
      expect(response.errors[0].message).toBe('GraphQL error');
      expect(response.errors[0].extensions.code).toBe('GRAPHQL_ERROR');
    });

    it('should handle generic Error', () => {
      const error = new Error('Generic error');
      const req = createMockReq() as Request;
      const res = createMockRes();
      const next = vi.fn();

      errorHandler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      const response = res.json.mock.calls[0][0];
      expect(response.errors[0].message).toBe('Generic error');
      expect(response.errors[0].extensions.code).toBe(ErrorCodes.INTERNAL_SERVER_ERROR);
    });

    it('should include extensions from ProxyError', () => {
      const error = new ProxyError(
        'Subgraph unavailable',
        ErrorCodes.SUBGRAPH_UNAVAILABLE,
        503,
        { subgraph: 'orders', url: 'http://orders:4001' }
      );
      const req = createMockReq() as Request;
      const res = createMockRes();
      const next = vi.fn();

      errorHandler(error, req, res, next);

      const response = res.json.mock.calls[0][0];
      expect(response.errors[0].extensions.subgraph).toBe('orders');
      expect(response.errors[0].extensions.url).toBe('http://orders:4001');
    });

    it('should not handle if headers already sent', () => {
      const error = new Error('Test error');
      const req = createMockReq() as Request;
      const res = createMockRes();
      res.headersSent = true;
      const next = vi.fn();

      errorHandler(error, req, res, next);

      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(error);
    });

    it('should use correct status code for different error codes', () => {
      const testCases = [
        { code: ErrorCodes.INVALID_URL, expectedStatus: 400 },
        { code: ErrorCodes.MISSING_QUERY, expectedStatus: 400 },
        { code: ErrorCodes.SUBGRAPH_NOT_FOUND, expectedStatus: 404 },
        { code: ErrorCodes.SUBGRAPH_UNAVAILABLE, expectedStatus: 503 },
        { code: ErrorCodes.INTERNAL_SERVER_ERROR, expectedStatus: 500 },
      ];

      testCases.forEach(({ code, expectedStatus }) => {
        const error = new ProxyError('Test', code, expectedStatus);
        const req = createMockReq() as Request;
        const res = createMockRes();
        const next = vi.fn();

        errorHandler(error, req, res, next);

        expect(res.status).toHaveBeenCalledWith(expectedStatus);
      });
    });
  });

  describe('asyncHandler wrapper', () => {
    it('should call next with error if async function throws', async () => {
      const error = new Error('Async error');
      const handler = asyncHandler(async () => {
        throw error;
      });

      const req = createMockReq() as Request;
      const res = createMockRes();
      const next = vi.fn();

      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });

    it('should not call next if async function succeeds', async () => {
      const handler = asyncHandler(async (req, res) => {
        res.json({ success: true });
      });

      const req = createMockReq() as Request;
      const res = createMockRes();
      const next = vi.fn();

      await handler(req, res, next);

      expect(res.json).toHaveBeenCalledWith({ success: true });
      expect(next).not.toHaveBeenCalled();
    });

    it('should pass request and response to handler', async () => {
      const handlerFn = vi.fn().mockResolvedValue(undefined);
      const handler = asyncHandler(handlerFn);

      const req = createMockReq() as Request;
      const res = createMockRes();
      const next = vi.fn();

      await handler(req, res, next);

      expect(handlerFn).toHaveBeenCalledWith(req, res, next);
    });

    it('should handle ProxyError from async function', async () => {
      const error = new ProxyError('Async proxy error', 'TEST_CODE', 400);
      const handler = asyncHandler(async () => {
        throw error;
      });

      const req = createMockReq() as Request;
      const res = createMockRes();
      const next = vi.fn();

      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });

    it('should handle rejected promises', async () => {
      const error = new Error('Promise rejection');
      const handler = asyncHandler(async () => {
        return Promise.reject(error);
      });

      const req = createMockReq() as Request;
      const res = createMockRes();
      const next = vi.fn();

      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('notFoundHandler', () => {
    it('should return 404 with error message', () => {
      const req = createMockReq({ method: 'GET', url: '/unknown' }) as Request;
      const res = createMockRes();

      notFoundHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalled();

      const response = res.json.mock.calls[0][0];
      expect(response.errors).toHaveLength(1);
      expect(response.errors[0].message).toContain('/unknown');
      expect(response.errors[0].extensions.code).toBe('NOT_FOUND');
    });

    it('should include request method in error', () => {
      const req = createMockReq({ method: 'POST', url: '/api/unknown' }) as Request;
      const res = createMockRes();

      notFoundHandler(req, res);

      const response = res.json.mock.calls[0][0];
      expect(response.errors[0].message).toContain('POST');
      expect(response.errors[0].extensions.method).toBe('POST');
    });

    it('should include request path in error', () => {
      const req = createMockReq({ url: '/api/v1/missing' }) as Request;
      const res = createMockRes();

      notFoundHandler(req, res);

      const response = res.json.mock.calls[0][0];
      expect(response.errors[0].extensions.path).toBe('/api/v1/missing');
    });
  });

  describe('Error Response Format', () => {
    it('should always include errors array', () => {
      const error = new Error('Test');
      const req = createMockReq() as Request;
      const res = createMockRes();
      const next = vi.fn();

      errorHandler(error, req, res, next);

      const response = res.json.mock.calls[0][0];
      expect(Array.isArray(response.errors)).toBe(true);
      expect(response.errors.length).toBeGreaterThan(0);
    });

    it('should include data field set to null', () => {
      const error = new Error('Test');
      const req = createMockReq() as Request;
      const res = createMockRes();
      const next = vi.fn();

      errorHandler(error, req, res, next);

      const response = res.json.mock.calls[0][0];
      expect(response.data).toBe(null);
    });

    it('should include extensions in error object', () => {
      const error = new ProxyError('Test', 'CODE', 500, { custom: 'data' });
      const req = createMockReq() as Request;
      const res = createMockRes();
      const next = vi.fn();

      errorHandler(error, req, res, next);

      const response = res.json.mock.calls[0][0];
      expect(response.errors[0].extensions).toBeDefined();
      expect(response.errors[0].extensions.code).toBe('CODE');
      expect(response.errors[0].extensions.custom).toBe('data');
    });
  });
});
