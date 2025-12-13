import axios, { AxiosResponse, AxiosError } from 'axios';
import { Request, Response } from 'express';
import { logger } from '../middleware/requestLogger';
import { SchemaCache } from '../services/SchemaCache';
import { isIntrospectionQuery } from '../utils/queryUtils';
import { printSchema } from 'graphql';

/**
 * PassThroughHandler forwards GraphQL requests to actual subgraph endpoints.
 *
 * This handler acts as a transparent proxy, forwarding requests with appropriate
 * headers and returning responses with proper status codes and headers. It handles
 * network errors, timeouts, and HTTP errors gracefully.
 *
 * @example
 * ```typescript
 * const handler = new PassThroughHandler();
 * await handler.handleRequest(req, res, 'http://subgraph.example.com/graphql');
 * ```
 */
export class PassThroughHandler {
  private readonly defaultTimeout: number = 30000; // 30 seconds

  /**
   * HTTP headers that should not be proxied according to RFC 7230 and RFC 2616.
   * These are hop-by-hop headers that are specific to a single transport-level connection.
   *
   * @private
   */
  private readonly hopByHopHeaders = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
  ]);

  /**
   * Headers that should not be forwarded to prevent proxy-related issues.
   * These headers are connection-specific or could cause issues when proxied.
   *
   * @private
   */
  private readonly nonProxyableHeaders = new Set([
    'host',           // Should be set by the HTTP client for the target URL
    'content-length', // Automatically calculated by axios/http client
    'content-encoding', // Will be handled by axios decompress option
  ]);

  constructor(private readonly schemaCache?: SchemaCache) {}

  /**
   * Sanitize headers by removing hop-by-hop and non-proxyable headers.
   *
   * This method filters out headers that should not be forwarded in a proxy scenario:
   * - Hop-by-hop headers (RFC 7230): connection, keep-alive, proxy-*, te, trailer, transfer-encoding, upgrade
   * - Connection-specific headers: host, content-length, content-encoding
   *
   * @param headers - The headers object to sanitize
   * @returns A new headers object with only safe-to-proxy headers
   *
   * @example
   * ```typescript
   * const sanitized = handler.sanitizeHeaders({
   *   'content-type': 'application/json',
   *   'authorization': 'Bearer token',
   *   'host': 'old-host.com',          // Removed
   *   'content-length': '1234',        // Removed
   *   'connection': 'keep-alive',      // Removed
   * });
   * // Result: { 'content-type': 'application/json', 'authorization': 'Bearer token' }
   * ```
   */
  public sanitizeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string | string[]> {
    const sanitized: Record<string, string | string[]> = {};

    for (const [key, value] of Object.entries(headers)) {
      // Skip undefined values
      if (value === undefined) {
        continue;
      }

      const lowerKey = key.toLowerCase();

      // Skip hop-by-hop headers
      if (this.hopByHopHeaders.has(lowerKey)) {
        logger.debug({ header: key }, '[PassThrough] Skipping hop-by-hop header');
        continue;
      }

      // Skip non-proxyable headers
      if (this.nonProxyableHeaders.has(lowerKey)) {
        logger.debug({ header: key }, '[PassThrough] Skipping non-proxyable header');
        continue;
      }

      // Include this header
      sanitized[key] = value;
    }

    return sanitized;
  }

  /**
   * Forward request to the actual subgraph endpoint.
   *
   * This method:
   * - Forwards the GraphQL request body and relevant headers
   * - Handles both successful and failed responses
   * - Propagates response headers and status codes
   * - Provides detailed error information for debugging
   *
   * @param req - Express request object containing the GraphQL query
   * @param res - Express response object for sending the response
   * @param targetUrl - The target subgraph URL to forward the request to
   * @param timeout - Optional timeout in milliseconds (default: 30000)
   * @throws {Error} If the request fails due to network or server errors
   *
   * @example
   * ```typescript
   * await handler.handleRequest(
   *   req,
   *   res,
   *   'http://products.subgraph.com/graphql',
   *   5000
   * );
   * ```
   */
  public async handleRequest(
    req: Request,
    res: Response,
    targetUrl: string,
    timeout: number = this.defaultTimeout,
    subgraphName?: string
  ): Promise<void> {
    try {
      logger.info({ targetUrl }, '[PassThrough] Forwarding request');

      // Sanitize incoming headers to remove hop-by-hop and non-proxyable headers
      const sanitizedHeaders = this.sanitizeHeaders(req.headers);

      // Forward the GraphQL request with proper headers and configuration
      const response: AxiosResponse = await axios.post(
        targetUrl,
        req.body,
        {
          headers: {
            'content-type': 'application/json', // Default content-type
            ...sanitizedHeaders, // Sanitized headers can override default
          },
          timeout,
          validateStatus: () => true,  // Accept any status code to handle errors gracefully
          maxRedirects: 5,
          decompress: true, // Automatically decompress response
        }
      );

      // Forward response headers
      for (const [key, value] of Object.entries(response.headers)) {
        res.setHeader(key, value as string);
      }

      // Add custom header to indicate this was proxied
      res.setHeader('X-Proxy-Mode', 'passthrough');
      res.setHeader('X-Proxy-Target', targetUrl);

      // Forward status code and body
      res.status(response.status).json(response.data);
    } catch (error) {
      // Handle axios errors with detailed logging
      await this.handleError(error as Error | AxiosError, targetUrl, res, req, subgraphName);
    }
  }

  /**
   * Check if the error is a connection/network error.
   *
   * @param error - The error to check
   * @returns boolean - true if it's a connection error
   *
   * @private
   */
  private isConnectionError(error: Error | AxiosError): boolean {
    return (
      axios.isAxiosError(error) &&
      (error.code === 'ECONNREFUSED' ||
        error.code === 'ENOTFOUND' ||
        error.code === 'ECONNABORTED' ||
        !error.response)
    );
  }

  /**
   * Send a GraphQL error response.
   *
   * @param res - Express response object
   * @param statusCode - HTTP status code
   * @param message - Error message
   * @param code - Error code for extensions
   * @param targetUrl - The target URL that was being accessed
   * @param additionalExtensions - Additional extension fields
   *
   * @private
   */
  private sendErrorResponse(
    res: Response,
    statusCode: number,
    message: string,
    code: string,
    targetUrl: string,
    additionalExtensions?: Record<string, unknown>
  ): void {
    res.status(statusCode).json({
      errors: [
        {
          message,
          extensions: {
            code,
            target: targetUrl,
            ...additionalExtensions,
          },
        },
      ],
    });
  }

  /**
   * Return cached SDL as introspection response.
   *
   * @param res - Express response object
   * @param targetUrl - The target URL that was being accessed
   * @param subgraphName - Name of the subgraph
   * @returns Promise<boolean> - true if SDL was successfully returned, false otherwise
   *
   * @private
   */
  private async returnCachedSdl(
    res: Response,
    targetUrl: string,
    subgraphName: string
  ): Promise<boolean> {
    try {
      logger.info(
        { subgraphName },
        '[PassThrough] Subgraph unavailable for introspection, using cached SDL'
      );
      const schema = await this.schemaCache!.getSchema(subgraphName);
      const sdl = printSchema(schema);

      res.setHeader('X-Proxy-Mode', 'passthrough-introspection-cached');
      res.setHeader('X-Proxy-Target', targetUrl);
      res.setHeader('X-Cache-Fallback', 'true');
      res.status(200).json({
        data: {
          _service: {
            sdl,
          },
        },
      });
      return true;
    } catch (cacheError) {
      logger.warn(
        { subgraphName, cacheError },
        '[PassThrough] Failed to get cached SDL for introspection fallback'
      );
      return false;
    }
  }

  /**
   * Handle errors that occur during request forwarding.
   *
   * This provides detailed error responses based on the error type:
   * - Timeout errors (504 Gateway Timeout)
   * - Network errors (502 Bad Gateway)
   * - Connection errors (503 Service Unavailable)
   * - General errors (500 Internal Server Error)
   *
   * For introspection queries that fail due to connection issues, attempts to
   * return cached SDL if available.
   *
   * @param error - The error that occurred
   * @param targetUrl - The target URL that was being accessed
   * @param res - Express response object
   * @param req - Express request object (optional, for introspection fallback)
   * @param subgraphName - Subgraph name (optional, for introspection fallback)
   *
   * @private
   */
  private async handleError(
    error: Error | AxiosError,
    targetUrl: string,
    res: Response,
    req?: Request,
    subgraphName?: string
  ): Promise<void> {
    logger.error({ targetUrl, error: error.message }, '[PassThrough] Error forwarding request');

    // Check if this is an introspection query that failed due to connection issues
    // If so, try to return cached SDL as a fallback
    if (req && subgraphName && this.schemaCache) {
      const body = req.body as { query?: string };
      if (body.query && isIntrospectionQuery(body.query)) {
        // Only use cache fallback for connection/network errors
        if (this.isConnectionError(error)) {
          const success = await this.returnCachedSdl(res, targetUrl, subgraphName);
          if (success) {
            return;
          }
          // Fall through to normal error handling if cache retrieval failed
        }
      }
    }

    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED') {
        // Timeout error
        this.sendErrorResponse(
          res,
          504,
          'Request timeout while forwarding to subgraph',
          'GATEWAY_TIMEOUT',
          targetUrl,
          { timeout: true }
        );
      } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        // Connection error
        this.sendErrorResponse(
          res,
          503,
          'Unable to connect to subgraph',
          'SERVICE_UNAVAILABLE',
          targetUrl,
          { errorCode: error.code }
        );
      } else if (!error.response) {
        // Network error without response
        this.sendErrorResponse(
          res,
          502,
          'Network error while forwarding to subgraph',
          'BAD_GATEWAY',
          targetUrl,
          { errorCode: error.code }
        );
      } else {
        // Unexpected error with response - this shouldn't happen due to validateStatus
        this.sendErrorResponse(
          res,
          500,
          'Unexpected error forwarding request',
          'INTERNAL_SERVER_ERROR',
          targetUrl
        );
      }
    } else {
      // Non-axios error
      this.sendErrorResponse(
        res,
        500,
        'Internal error while forwarding request',
        'INTERNAL_SERVER_ERROR',
        targetUrl
      );
    }
  }
}
