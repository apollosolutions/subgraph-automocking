import { describe, it, expect, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import {
  urlDecoderMiddleware,
  extractSubgraphName,
  decodeTargetUrl,
  RequestWithTargetUrl,
} from '../../../src/middleware/urlDecoder';
import { ProxyError, ErrorCodes } from '../../../src/middleware/errorHandler';

/**
 * URL Decoder Middleware Tests
 *
 * Tests URL decoding, validation, and subgraph name extraction functionality.
 */

// Test helper to create mock Express request/response
function createMockReq(encodedUrl?: string, subgraphName?: string): Partial<Request> {
  const headers: Record<string, string> = {};
  if (subgraphName) {
    headers['x-subgraph-name'] = subgraphName;
  }
  return {
    params: { encodedUrl },
    headers,
    body: {},
    log: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any,
  };
}

function createMockRes(): Partial<Response> {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

describe('URL Decoder Middleware', () => {
  describe('urlDecoderMiddleware', () => {
    it('should decode valid URL successfully with x-subgraph-name header', () => {
      const encodedUrl = encodeURIComponent('http://orders-service:4001');
      const req = createMockReq(encodedUrl, 'orders') as Request;
      const res = createMockRes() as Response;
      const next = vi.fn();

      urlDecoderMiddleware(req, res, next);

      expect((req as RequestWithTargetUrl).targetUrl).toBe('http://orders-service:4001');
      expect((req as RequestWithTargetUrl).subgraphName).toBe('orders');
      expect(next).toHaveBeenCalledWith();
    });

    it('should decode URL with path', () => {
      const encodedUrl = encodeURIComponent('http://api.example.com/graphql');
      const req = createMockReq(encodedUrl, 'api') as Request;
      const res = createMockRes() as Response;
      const next = vi.fn();

      urlDecoderMiddleware(req, res, next);

      expect((req as RequestWithTargetUrl).targetUrl).toBe('http://api.example.com/graphql');
      expect((req as RequestWithTargetUrl).subgraphName).toBe('api');
      expect(next).toHaveBeenCalledWith();
    });

    it('should handle localhost URLs', () => {
      const encodedUrl = encodeURIComponent('http://localhost:4001');
      const req = createMockReq(encodedUrl, 'localhost') as Request;
      const res = createMockRes() as Response;
      const next = vi.fn();

      urlDecoderMiddleware(req, res, next);

      expect((req as RequestWithTargetUrl).targetUrl).toBe('http://localhost:4001');
      expect((req as RequestWithTargetUrl).subgraphName).toBe('localhost');
      expect(next).toHaveBeenCalledWith();
    });

    it('should handle IP address URLs', () => {
      const encodedUrl = encodeURIComponent('http://192.168.1.100:4001');
      const req = createMockReq(encodedUrl, 'products') as Request;
      const res = createMockRes() as Response;
      const next = vi.fn();

      urlDecoderMiddleware(req, res, next);

      expect((req as RequestWithTargetUrl).targetUrl).toBe('http://192.168.1.100:4001');
      expect((req as RequestWithTargetUrl).subgraphName).toBe('products');
      expect(next).toHaveBeenCalledWith();
    });

    it('should call next with error if x-subgraph-name header is missing', () => {
      const encodedUrl = encodeURIComponent('http://orders-service:4001');
      const req = createMockReq(encodedUrl) as Request; // No header
      const res = createMockRes() as Response;
      const next = vi.fn();

      urlDecoderMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      const error = next.mock.calls[0][0];
      expect(error).toBeInstanceOf(ProxyError);
      expect(error.code).toBe(ErrorCodes.INVALID_GRAPHQL_REQUEST);
      expect(error.statusCode).toBe(400);
      expect(error.message).toContain('x-subgraph-name');
    });

    it('should call next with error if encodedUrl is missing', () => {
      const req = createMockReq() as Request;
      const res = createMockRes() as Response;
      const next = vi.fn();

      urlDecoderMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      const error = next.mock.calls[0][0];
      expect(error).toBeInstanceOf(ProxyError);
      expect(error.code).toBe(ErrorCodes.INVALID_URL);
      expect(error.statusCode).toBe(400);
    });

    it('should call next with error if URL encoding is invalid', () => {
      const req = createMockReq('%ZZ%invalid') as Request;
      const res = createMockRes() as Response;
      const next = vi.fn();

      urlDecoderMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      const error = next.mock.calls[0][0];
      expect(error).toBeInstanceOf(ProxyError);
      expect(error.code).toBe(ErrorCodes.INVALID_URL);
    });

    it('should call next with error if decoded URL is invalid', () => {
      const encodedUrl = encodeURIComponent('not-a-url');
      const req = createMockReq(encodedUrl) as Request;
      const res = createMockRes() as Response;
      const next = vi.fn();

      urlDecoderMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      const error = next.mock.calls[0][0];
      expect(error).toBeInstanceOf(ProxyError);
      expect(error.code).toBe(ErrorCodes.INVALID_URL);
    });

    it('should reject FTP URLs', () => {
      const encodedUrl = encodeURIComponent('ftp://files.example.com');
      const req = createMockReq(encodedUrl) as Request;
      const res = createMockRes() as Response;
      const next = vi.fn();

      urlDecoderMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      const error = next.mock.calls[0][0];
      expect(error).toBeInstanceOf(ProxyError);
      expect(error.code).toBe(ErrorCodes.INVALID_URL);
    });

    it('should accept HTTPS URLs', () => {
      const encodedUrl = encodeURIComponent('https://api.example.com');
      const req = createMockReq(encodedUrl, 'api') as Request;
      const res = createMockRes() as Response;
      const next = vi.fn();

      urlDecoderMiddleware(req, res, next);

      expect((req as RequestWithTargetUrl).targetUrl).toBe('https://api.example.com');
      expect((req as RequestWithTargetUrl).subgraphName).toBe('api');
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('extractSubgraphName', () => {
    it('should extract subgraph name from x-subgraph-name header', () => {
      const req = createMockReq(encodeURIComponent('http://orders-service:4001'), 'orders') as Request;
      const targetUrl = 'http://orders-service:4001';

      expect(extractSubgraphName(req, targetUrl)).toBe('orders');
    });

    it('should handle different subgraph names', () => {
      const targetUrl = 'http://example.com';

      const req1 = createMockReq(encodeURIComponent(targetUrl), 'products') as Request;
      expect(extractSubgraphName(req1, targetUrl)).toBe('products');

      const req2 = createMockReq(encodeURIComponent(targetUrl), 'users') as Request;
      expect(extractSubgraphName(req2, targetUrl)).toBe('users');

      const req3 = createMockReq(encodeURIComponent(targetUrl), 'reviews') as Request;
      expect(extractSubgraphName(req3, targetUrl)).toBe('reviews');
    });

    it('should throw error when x-subgraph-name header is missing', () => {
      const req = createMockReq(encodeURIComponent('http://orders-service:4001')) as Request;
      const targetUrl = 'http://orders-service:4001';

      expect(() => extractSubgraphName(req, targetUrl)).toThrow(ProxyError);
      expect(() => extractSubgraphName(req, targetUrl)).toThrow('x-subgraph-name header is required');
    });

    it('should throw error when x-subgraph-name header is empty string', () => {
      const req = createMockReq(encodeURIComponent('http://orders-service:4001'), '') as Request;
      const targetUrl = 'http://orders-service:4001';

      expect(() => extractSubgraphName(req, targetUrl)).toThrow(ProxyError);
    });

    it('should throw error with correct error code and status', () => {
      const req = createMockReq(encodeURIComponent('http://orders-service:4001')) as Request;
      const targetUrl = 'http://orders-service:4001';

      try {
        extractSubgraphName(req, targetUrl);
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(ProxyError);
        expect((error as ProxyError).code).toBe(ErrorCodes.INVALID_GRAPHQL_REQUEST);
        expect((error as ProxyError).statusCode).toBe(400);
      }
    });
  });

  describe('decodeTargetUrl', () => {
    it('should decode valid encoded URL', () => {
      const encoded = encodeURIComponent('http://orders:4001');
      expect(decodeTargetUrl(encoded)).toBe('http://orders:4001');
    });

    it('should throw error for empty string', () => {
      expect(() => decodeTargetUrl('')).toThrow(ProxyError);
    });

    it('should throw error for invalid encoding', () => {
      expect(() => decodeTargetUrl('%ZZ')).toThrow(ProxyError);
    });

    it('should throw error if decoded result is not valid URL', () => {
      const encoded = encodeURIComponent('not-a-url');
      expect(() => decodeTargetUrl(encoded)).toThrow(ProxyError);
    });

    it('should handle URLs with query parameters', () => {
      const url = 'http://api.example.com/graphql?debug=true';
      const encoded = encodeURIComponent(url);
      expect(decodeTargetUrl(encoded)).toBe(url);
    });

    it('should handle URLs with fragments', () => {
      const url = 'http://api.example.com/graphql#section';
      const encoded = encodeURIComponent(url);
      expect(decodeTargetUrl(encoded)).toBe(url);
    });
  });

  describe('Edge Cases', () => {
    it('should handle double-encoded URLs', () => {
      const url = 'http://orders:4001';
      const doubleEncoded = encodeURIComponent(encodeURIComponent(url));
      const req = createMockReq(doubleEncoded, 'orders') as Request;
      const res = createMockRes() as Response;
      const next = vi.fn();

      urlDecoderMiddleware(req, res, next);

      // Should decode once, leaving it still encoded (invalid URL)
      expect(next).toHaveBeenCalled();
      const error = next.mock.calls[0][0];
      expect(error).toBeInstanceOf(ProxyError);
    });

    it('should handle URLs with special characters', () => {
      const url = 'http://api.example.com/path?query=value&other=test';
      const encoded = encodeURIComponent(url);
      const req = createMockReq(encoded, 'api') as Request;
      const res = createMockRes() as Response;
      const next = vi.fn();

      urlDecoderMiddleware(req, res, next);

      expect((req as RequestWithTargetUrl).targetUrl).toBe(url);
      expect((req as RequestWithTargetUrl).subgraphName).toBe('api');
      expect(next).toHaveBeenCalledWith();
    });

    it('should handle URLs with authentication', () => {
      const url = 'http://user:pass@api.example.com:4001';
      const encoded = encodeURIComponent(url);
      const req = createMockReq(encoded, 'api') as Request;
      const res = createMockRes() as Response;
      const next = vi.fn();

      urlDecoderMiddleware(req, res, next);

      expect((req as RequestWithTargetUrl).targetUrl).toBe(url);
      expect((req as RequestWithTargetUrl).subgraphName).toBe('api');
      expect(next).toHaveBeenCalledWith();
    });

    it('should handle very long URLs', () => {
      const longPath = '/very/long/path/' + 'segment/'.repeat(100);
      const url = `http://api.example.com${longPath}`;
      const encoded = encodeURIComponent(url);
      const req = createMockReq(encoded, 'api') as Request;
      const res = createMockRes() as Response;
      const next = vi.fn();

      urlDecoderMiddleware(req, res, next);

      expect((req as RequestWithTargetUrl).targetUrl).toBe(url);
      expect((req as RequestWithTargetUrl).subgraphName).toBe('api');
      expect(next).toHaveBeenCalledWith();
    });
  });
});
