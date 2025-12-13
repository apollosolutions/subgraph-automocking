import { Request, Response, NextFunction } from 'express';
import { GraphQLError, SourceLocation } from 'graphql';
import { logger } from './requestLogger';

/**
 * Standard GraphQL error response format
 *
 * Follows the GraphQL specification for error responses with
 * additional extensions for debugging and error classification.
 */
export interface GraphQLErrorResponse {
  errors: Array<{
    message: string;
    locations?: readonly SourceLocation[] | undefined;
    path?: readonly (string | number)[] | undefined;
    extensions?: {
      code: string;
      subgraph?: string;
      targetUrl?: string;
      originalError?: string;
      statusCode?: number;
      [key: string]: unknown;
    };
  }>;
  data?: null;
}

/**
 * Custom error class for proxy-specific errors
 *
 * Extends the base Error class to include additional context
 * specific to the mocking proxy's operations.
 *
 * @example
 * ```typescript
 * throw new ProxyError(
 *   'Subgraph unavailable',
 *   'SUBGRAPH_UNAVAILABLE',
 *   503,
 *   { subgraph: 'orders', url: 'http://orders:4001' }
 * );
 * ```
 */
export class ProxyError extends Error {
  constructor(
    message: string,
    public code: string = 'INTERNAL_SERVER_ERROR',
    public statusCode: number = 500,
    public extensions: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'ProxyError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error code constants for consistent error classification
 */
export const ErrorCodes = {
  // Request errors (4xx)
  INVALID_URL: 'INVALID_URL',
  INVALID_GRAPHQL_REQUEST: 'INVALID_GRAPHQL_REQUEST',
  MISSING_QUERY: 'MISSING_QUERY',
  SUBGRAPH_NOT_FOUND: 'SUBGRAPH_NOT_FOUND',

  // Service errors (5xx)
  SUBGRAPH_UNAVAILABLE: 'SUBGRAPH_UNAVAILABLE',
  SCHEMA_FETCH_FAILED: 'SCHEMA_FETCH_FAILED',
  MOCK_GENERATION_ERROR: 'MOCK_GENERATION_ERROR',
  PASSTHROUGH_FAILED: 'PASSTHROUGH_FAILED',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
} as const;

/**
 * Determine HTTP status code from error type
 *
 * Maps error codes to appropriate HTTP status codes following
 * REST conventions while maintaining GraphQL compatibility.
 *
 * @param {string} code - Error code
 * @returns {number} HTTP status code
 */
function getStatusCodeFromErrorCode(code: string): number {
  const statusCodeMap: Record<string, number> = {
    [ErrorCodes.INVALID_URL]: 400,
    [ErrorCodes.INVALID_GRAPHQL_REQUEST]: 400,
    [ErrorCodes.MISSING_QUERY]: 400,
    [ErrorCodes.SUBGRAPH_NOT_FOUND]: 404,
    [ErrorCodes.SUBGRAPH_UNAVAILABLE]: 503,
    [ErrorCodes.SCHEMA_FETCH_FAILED]: 502,
    [ErrorCodes.MOCK_GENERATION_ERROR]: 500,
    [ErrorCodes.PASSTHROUGH_FAILED]: 502,
    [ErrorCodes.INTERNAL_SERVER_ERROR]: 500,
  };

  return statusCodeMap[code] || 500;
}

/**
 * Convert various error types to GraphQL-formatted error response
 *
 * Handles multiple error types and formats them into standardized
 * GraphQL error responses with appropriate extensions and metadata.
 *
 * @param {Error | GraphQLError | ProxyError} error - Error to format
 * @param {Request} req - Express request object for context
 * @returns {GraphQLErrorResponse} Formatted error response
 */
function formatGraphQLError(
  error: Error | GraphQLError | ProxyError,
  _req: Request
): GraphQLErrorResponse {
  // Handle ProxyError with custom code and extensions
  if (error instanceof ProxyError) {
    return {
      errors: [{
        message: error.message,
        extensions: {
          code: error.code,
          statusCode: error.statusCode,
          ...error.extensions,
        },
      }],
      data: null,
    };
  }

  // Handle GraphQLError
  if (error instanceof GraphQLError) {
    return {
      errors: [{
        message: error.message,
        locations: error.locations,
        path: error.path,
        extensions: {
          code: (error.extensions?.['code'] as string) || ErrorCodes.INTERNAL_SERVER_ERROR,
          ...error.extensions,
        },
      }],
      data: null,
    };
  }

  // Handle generic errors
  const errorWithOperational = error as Error & { isOperational?: boolean };
  const isOperationalError = errorWithOperational.isOperational || false;

  return {
    errors: [{
      message: error.message || 'An unexpected error occurred',
      extensions: {
        code: ErrorCodes.INTERNAL_SERVER_ERROR,
        originalError: error.name,
        isOperational: isOperationalError,
      },
    }],
    data: null,
  };
}

/**
 * Global error handling middleware for Express
 *
 * This middleware catches all errors thrown in route handlers and other
 * middleware, formats them as GraphQL-compliant error responses, and
 * logs them appropriately based on severity.
 *
 * Features:
 * - GraphQL-compliant error formatting
 * - Structured error logging with context
 * - Automatic status code determination
 * - Development vs. production error details
 * - Error classification and extensions
 *
 * @param {Error} err - Error object
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {NextFunction} next - Express next function
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { errorHandler } from './middleware/errorHandler';
 *
 * const app = express();
 *
 * // Register routes...
 *
 * // Error handler must be registered last
 * app.use(errorHandler);
 * ```
 */
export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // If response already sent, delegate to default Express error handler
  if (res.headersSent) {
    return next(err);
  }

  // Determine status code
  const errorWithCode = err as Error & { code?: string };
  const statusCode = err instanceof ProxyError
    ? err.statusCode
    : getStatusCodeFromErrorCode(errorWithCode.code || ErrorCodes.INTERNAL_SERVER_ERROR);

  // Format error as GraphQL response
  const errorResponse = formatGraphQLError(err, req);

  // Log error with appropriate level and context
  interface RequestWithTargetInfo {
    targetUrl?: string;
    subgraphName?: string;
  }
  const reqWithTarget = req as Request & RequestWithTargetInfo;

  const logContext = {
    err,
    request: {
      method: req.method,
      url: req.url,
      targetUrl: reqWithTarget.targetUrl,
      subgraphName: reqWithTarget.subgraphName,
      headers: {
        'user-agent': req.headers['user-agent'],
        'x-request-id': req.headers['x-request-id'],
      },
    },
    response: {
      statusCode,
      errorCode: errorResponse.errors[0]?.extensions?.code,
    },
  };

  if (statusCode >= 500) {
    logger.error(logContext, `Server error: ${err.message}`);
  } else {
    logger.warn(logContext, `Client error: ${err.message}`);
  }

  // Send error response
  res.status(statusCode).json(errorResponse);
};

/**
 * Async error wrapper for route handlers
 *
 * Wraps async route handlers to automatically catch and forward errors
 * to the error handling middleware, eliminating the need for try-catch
 * blocks in every route.
 *
 * @param {Function} fn - Async route handler function
 * @returns {Function} Wrapped handler with error catching
 *
 * @example
 * ```typescript
 * import { asyncHandler } from './middleware/errorHandler';
 *
 * app.get('/api/data', asyncHandler(async (req, res) => {
 *   const data = await fetchData(); // Errors automatically caught
 *   res.json(data);
 * }));
 * ```
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    return Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * 404 Not Found handler
 *
 * Middleware to handle requests to undefined routes with a properly
 * formatted GraphQL error response.
 *
 * @example
 * ```typescript
 * // Register after all other routes
 * app.use(notFoundHandler);
 * app.use(errorHandler);
 * ```
 */
export const notFoundHandler = (req: Request, res: Response): void => {
  const error: GraphQLErrorResponse = {
    errors: [{
      message: `Route ${req.method} ${req.url} not found`,
      extensions: {
        code: 'NOT_FOUND',
        statusCode: 404,
        method: req.method,
        path: req.url,
      },
    }],
    data: null,
  };

  logger.warn({
    request: {
      method: req.method,
      url: req.url,
    },
  }, 'Route not found');

  res.status(404).json(error);
};
