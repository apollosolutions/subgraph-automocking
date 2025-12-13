import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { logger, attachRequestLogger, logGraphQLOperation } from '../requestLogger';

// Mock pino
vi.mock('pino', () => {
  const mockPino = vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  }));

  mockPino.stdSerializers = {
    req: vi.fn(),
    res: vi.fn(),
    err: vi.fn(),
  };

  return {
    default: mockPino,
  };
});

// Mock pino-http
vi.mock('pino-http', () => ({
  default: vi.fn((options) => {
    return (req: Request, res: Response, next: NextFunction) => {
      // Simulate pino-http attaching logger to request
      req.log = {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn(() => ({
          info: vi.fn(),
          debug: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        })),
      };
      next();
    };
  }),
}));

describe('requestLogger', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    mockRequest = {
      headers: {},
      body: {},
      log: undefined,
    };
    mockResponse = {
      statusCode: 200,
    };
    nextFunction = vi.fn();
    vi.clearAllMocks();
  });

  describe('logger', () => {
    it('should export logger instance', () => {
      expect(logger).toBeDefined();
      expect(logger.info).toBeDefined();
      expect(logger.debug).toBeDefined();
      expect(logger.warn).toBeDefined();
      expect(logger.error).toBeDefined();
    });

    it('should have child method for creating child loggers', () => {
      expect(logger.child).toBeDefined();
      const childLogger = logger.child({ component: 'test' });
      expect(childLogger).toBeDefined();
      expect(childLogger.info).toBeDefined();
    });
  });

  describe('attachRequestLogger', () => {
    it('should attach logger to request when not present', () => {
      const req = mockRequest as Request;
      const res = mockResponse as Response;

      attachRequestLogger(req, res, nextFunction);

      expect(req.log).toBeDefined();
      expect(req.log?.debug).toBeDefined();
      expect(nextFunction).toHaveBeenCalledOnce();
    });

    it('should not overwrite existing logger on request', () => {
      const existingLogger = {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn(),
      };

      const req = {
        ...mockRequest,
        log: existingLogger,
        headers: { 'x-request-id': 'test-123' },
      } as Request;
      const res = mockResponse as Response;

      attachRequestLogger(req, res, nextFunction);

      expect(req.log).toBe(existingLogger);
      expect(nextFunction).toHaveBeenCalledOnce();
    });

    it('should use x-request-id header if present', () => {
      const req = {
        ...mockRequest,
        headers: { 'x-request-id': 'custom-req-id' },
      } as Request;
      const res = mockResponse as Response;

      attachRequestLogger(req, res, nextFunction);

      expect(req.log).toBeDefined();
      expect(nextFunction).toHaveBeenCalledOnce();
    });

    it('should generate request ID if x-request-id header missing', () => {
      const req = {
        ...mockRequest,
        headers: {},
      } as Request;
      const res = mockResponse as Response;

      attachRequestLogger(req, res, nextFunction);

      expect(req.log).toBeDefined();
      expect(nextFunction).toHaveBeenCalledOnce();
    });
  });

  describe('logGraphQLOperation', () => {
    it('should log GraphQL operation with query', () => {
      const mockLog = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn(),
      };

      const req = {
        ...mockRequest,
        log: mockLog,
        body: {
          query: 'query GetProduct { product(id: "1") { id name } }',
          operationName: 'GetProduct',
          variables: { id: '1' },
        },
      } as Request;
      const res = mockResponse as Response;

      logGraphQLOperation(req, res, nextFunction);

      expect(mockLog.debug).toHaveBeenCalledWith(
        {
          graphql: {
            operationName: 'GetProduct',
            variableCount: 1,
            queryLength: expect.any(Number),
          },
        },
        'GraphQL operation received'
      );
      expect(nextFunction).toHaveBeenCalledOnce();
    });

    it('should handle anonymous GraphQL operations', () => {
      const mockLog = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn(),
      };

      const req = {
        ...mockRequest,
        log: mockLog,
        body: {
          query: '{ products { id } }',
        },
      } as Request;
      const res = mockResponse as Response;

      logGraphQLOperation(req, res, nextFunction);

      expect(mockLog.debug).toHaveBeenCalledWith(
        {
          graphql: {
            operationName: 'anonymous',
            variableCount: 0,
            queryLength: expect.any(Number),
          },
        },
        'GraphQL operation received'
      );
      expect(nextFunction).toHaveBeenCalledOnce();
    });

    it('should handle GraphQL operation with no variables', () => {
      const mockLog = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn(),
      };

      const req = {
        ...mockRequest,
        log: mockLog,
        body: {
          query: 'query GetProducts { products { id } }',
          operationName: 'GetProducts',
        },
      } as Request;
      const res = mockResponse as Response;

      logGraphQLOperation(req, res, nextFunction);

      expect(mockLog.debug).toHaveBeenCalledWith(
        {
          graphql: {
            operationName: 'GetProducts',
            variableCount: 0,
            queryLength: expect.any(Number),
          },
        },
        'GraphQL operation received'
      );
      expect(nextFunction).toHaveBeenCalledOnce();
    });

    it('should handle GraphQL operation with multiple variables', () => {
      const mockLog = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn(),
      };

      const req = {
        ...mockRequest,
        log: mockLog,
        body: {
          query: 'query SearchProducts($category: String!, $minPrice: Float, $maxPrice: Float) { products { id } }',
          operationName: 'SearchProducts',
          variables: { category: 'electronics', minPrice: 10.0, maxPrice: 100.0 },
        },
      } as Request;
      const res = mockResponse as Response;

      logGraphQLOperation(req, res, nextFunction);

      expect(mockLog.debug).toHaveBeenCalledWith(
        {
          graphql: {
            operationName: 'SearchProducts',
            variableCount: 3,
            queryLength: expect.any(Number),
          },
        },
        'GraphQL operation received'
      );
      expect(nextFunction).toHaveBeenCalledOnce();
    });

    it('should skip logging when no query present in body', () => {
      const mockLog = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn(),
      };

      const req = {
        ...mockRequest,
        log: mockLog,
        body: {},
      } as Request;
      const res = mockResponse as Response;

      logGraphQLOperation(req, res, nextFunction);

      expect(mockLog.debug).not.toHaveBeenCalled();
      expect(nextFunction).toHaveBeenCalledOnce();
    });

    it('should skip logging when query is not a string', () => {
      const mockLog = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn(),
      };

      const req = {
        ...mockRequest,
        log: mockLog,
        body: {
          query: { field: 'invalid' }, // Not a string
        },
      } as Request;
      const res = mockResponse as Response;

      logGraphQLOperation(req, res, nextFunction);

      expect(mockLog.debug).not.toHaveBeenCalled();
      expect(nextFunction).toHaveBeenCalledOnce();
    });

    it('should skip logging when body is undefined', () => {
      const mockLog = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn(),
      };

      const req = {
        ...mockRequest,
        log: mockLog,
        body: undefined,
      } as Request;
      const res = mockResponse as Response;

      logGraphQLOperation(req, res, nextFunction);

      expect(mockLog.debug).not.toHaveBeenCalled();
      expect(nextFunction).toHaveBeenCalledOnce();
    });

    it('should handle request without logger attached', () => {
      const req = {
        ...mockRequest,
        log: undefined,
        body: {
          query: '{ products { id } }',
        },
      } as Request;
      const res = mockResponse as Response;

      // Should not throw
      expect(() => logGraphQLOperation(req, res, nextFunction)).not.toThrow();
      expect(nextFunction).toHaveBeenCalledOnce();
    });
  });

  describe('requestLoggerMiddleware configuration', () => {
    it('should import requestLoggerMiddleware successfully', async () => {
      const { requestLoggerMiddleware } = await import('../requestLogger');
      expect(requestLoggerMiddleware).toBeDefined();
      expect(typeof requestLoggerMiddleware).toBe('function');
    });
  });
});
