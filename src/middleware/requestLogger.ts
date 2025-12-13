import { Request, Response, NextFunction } from 'express';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { env, isDevelopment, isTest } from '../config/environment';

/**
 * Pino logger instance for application-wide logging
 *
 * @example
 * ```typescript
 * import { logger } from './middleware/requestLogger';
 * logger.info('Server started');
 * logger.debug({ query: graphqlQuery }, 'Processing GraphQL query');
 * ```
 */
interface PinoConfigBase {
  level: string;
  base: {
    pid: number;
    hostname: string;
  };
  timestamp: () => string;
  serializers: {
    req: typeof pino.stdSerializers.req;
    res: typeof pino.stdSerializers.res;
    err: typeof pino.stdSerializers.err;
  };
  transport?: {
    target: string;
    options: {
      colorize: boolean;
      translateTime: string;
      ignore: string;
      singleLine: boolean;
    };
  };
}

const pinoConfig: PinoConfigBase = {
  level: env.LOG_LEVEL,
  base: {
    pid: process.pid,
    hostname: process.env['HOSTNAME'] || 'unknown',
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
  serializers: {
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
    err: pino.stdSerializers.err,
  },
};

// Add pretty print transport only in development when enabled
if (isDevelopment() && env.LOG_PRETTY_PRINT) {
  pinoConfig.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
      singleLine: false,
    },
  };
}

export const logger = pino(pinoConfig);


/**
 * Pino HTTP middleware for Express
 *
 * This middleware automatically logs all HTTP requests and responses with
 * detailed information including:
 * - Request method, URL, and headers
 * - Response status code and duration
 * - GraphQL operation details (if present)
 * - Mock response indicators
 * - Unique request IDs for tracing
 *
 * The middleware uses different log levels based on response status:
 * - 2xx: info
 * - 3xx: info
 * - 4xx: warn
 * - 5xx: error
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { requestLoggerMiddleware } from './middleware/requestLogger';
 *
 * const app = express();
 * app.use(requestLoggerMiddleware);
 * ```
 */
export const requestLoggerMiddleware = pinoHttp({
  logger,

  // Use custom serializers
  serializers: {
    req: () => {},
    res: () => {},
  },

  // Generate unique request ID for tracing
  genReqId: (req) => req.headers['x-request-id'] as string ||
                     `req-${Date.now()}-${Math.random().toString(36).substring(7)}`,

  // Custom log level based on response status
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) {
      return 'error';
    }
    if (res.statusCode >= 400) {
      return 'warn';
    }
    if (res.statusCode >= 300) {
      return 'info';
    }
    return 'info';
  },

  // Custom success message
  customSuccessMessage: (req, res) => {
    return `${req.method} ${req.url} completed with ${res.statusCode}`;
  },

  // Custom error message
  customErrorMessage: (req, res, err) => {
    return `${req.method} ${req.url} failed with ${res.statusCode}: ${err.message}`;
  },

  // Include request/response in logs based on level
  customAttributeKeys: {
    req: 'request',
    res: 'response',
    err: 'error',
    responseTime: 'duration',
  },

  // Automatically log request completion
  autoLogging: !isTest(),

  // Custom request properties to include
  customProps: (req: Request) => {
    interface RequestWithTargetInfo {
      targetUrl?: string;
      subgraphName?: string;
    }
    const reqWithTarget = req as Request & RequestWithTargetInfo;
    return {
      targetUrl: reqWithTarget.targetUrl || null,
      subgraphName: reqWithTarget.subgraphName || null,
    };
  },
});

/**
 * Request-scoped logger attachment middleware
 *
 * This middleware attaches a request-scoped logger to each request object,
 * allowing child loggers with request context to be used throughout
 * the request lifecycle.
 *
 * @example
 * ```typescript
 * app.get('/api/health', (req, res) => {
 *   req.log.info('Health check requested');
 *   res.json({ status: 'healthy' });
 * });
 * ```
 */
export const attachRequestLogger = (req: Request, _res: Response, next: NextFunction): void => {
  // Attach logger to request if not already present (pino-http should do this)
  if (!req.log) {
    req.log = logger.child({
      reqId: req.headers['x-request-id'] || `req-${Date.now()}`,
    });
  }
  next();
};

/**
 * Middleware to log GraphQL operation details
 *
 * This middleware extracts and logs specific GraphQL operation information
 * from request bodies. It should be placed after body parsing middleware.
 *
 * @example
 * ```typescript
 * app.use(express.json());
 * app.use(logGraphQLOperation);
 * ```
 */
export const logGraphQLOperation = (req: Request, _res: Response, next: NextFunction): void => {
  interface RequestWithGraphQL {
    body?: {
      query?: string;
      operationName?: string;
      variables?: Record<string, unknown>;
    };
  }
  const reqWithBody = req as RequestWithGraphQL;

  if (reqWithBody.body?.query && typeof reqWithBody.body.query === 'string') {
    const { query, operationName, variables } = reqWithBody.body;

    req.log?.debug({
      graphql: {
        operationName: operationName || 'anonymous',
        variableCount: variables ? Object.keys(variables).length : 0,
        queryLength: query.length,
      },
    }, 'GraphQL operation received');
  }

  next();
};
