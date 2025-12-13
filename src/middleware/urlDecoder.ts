import { Request, Response, NextFunction } from 'express';
import { ProxyError, ErrorCodes } from './errorHandler';
import { logger } from './requestLogger';

/**
 * Extended Express Request interface with decoded URL
 *
 * Adds custom properties to the request object for use in downstream
 * middleware and route handlers.
 */
export interface RequestWithTargetUrl extends Request {
  /** Decoded target URL extracted from the request path */
  targetUrl: string;
  /** Extracted subgraph name (if determinable) */
  subgraphName?: string;
}

/**
 * URL validation regex patterns
 */
const URL_PATTERNS = {
  /** Valid URL protocol (http or https) */
  PROTOCOL: /^https?:\/\//i,
  /** Valid hostname pattern */
  HOSTNAME: /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i,
};

/**
 * Validate URL format and structure
 *
 * Performs comprehensive validation of the decoded URL to ensure it's
 * well-formed and safe to use for proxying requests.
 *
 * @param {string} url - URL to validate
 * @returns {boolean} True if URL is valid
 *
 * @example
 * ```typescript
 * validateUrl('http://orders-service:4001'); // true
 * validateUrl('ftp://invalid:4001'); // false
 * validateUrl('not a url'); // false
 * ```
 */
function validateUrl(url: string): boolean {
  try {
    // Check for valid protocol
    if (!URL_PATTERNS.PROTOCOL.test(url)) {
      return false;
    }

    // Parse URL
    const parsedUrl = new URL(url);

    // Validate hostname is not empty
    if (!parsedUrl.hostname) {
      return false;
    }

    // Validate hostname format (allow localhost and IPs)
    if (
      parsedUrl.hostname !== 'localhost' &&
      !parsedUrl.hostname.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/) &&
      !URL_PATTERNS.HOSTNAME.test(parsedUrl.hostname)
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Extract and validate subgraph name from request header
 *
 * Extracts the subgraph name from the `x-subgraph-name` header and validates
 * that it exists and is a valid string value.
 *
 * @param {Request} req - Express request object
 * @param {string} targetUrl - Target URL for error context
 * @returns {string} Validated subgraph name from header
 * @throws {ProxyError} If header is missing or invalid
 *
 * @example
 * ```typescript
 * const subgraphName = extractSubgraphName(req, targetUrl);
 * // Returns "products" if x-subgraph-name header is "products"
 * ```
 */
export function extractSubgraphName(req: Request, targetUrl: string): string {
  const subgraphName = req.headers['x-subgraph-name'];

  if (!subgraphName || typeof subgraphName !== 'string') {
    logger.error({
      targetUrl,
      headers: req.headers,
    }, 'Missing or invalid x-subgraph-name header');

    throw new ProxyError(
      'x-subgraph-name header is required',
      ErrorCodes.INVALID_GRAPHQL_REQUEST,
      400,
      {
        hint: 'Include the x-subgraph-name header with the subgraph identifier',
        example: 'x-subgraph-name: products',
      }
    );
  }

  return subgraphName;
}

/**
 * Decode and validate URL from request path parameter
 *
 * This middleware extracts the URL-encoded target URL from the request path,
 * decodes it, validates its format, and reads the subgraph name from the
 * x-subgraph-name header.
 *
 * The middleware expects:
 * - URLs to be encoded in the path as: `POST /:encodedUrl`
 * - Subgraph name in header: `x-subgraph-name: products`
 *
 * For example:
 * - Actual URL: `http://orders-service:4001`
 * - Encoded URL: `http%3A%2F%2Forders-service%3A4001`
 * - Request path: `POST /http%3A%2F%2Forders-service%3A4001`
 * - Header: `x-subgraph-name: orders`
 *
 * Features:
 * - URL decoding with error handling
 * - URL format validation
 * - Subgraph name from header
 * - Structured error responses
 * - Request context enrichment
 *
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {NextFunction} next - Express next function
 *
 * @throws {ProxyError} If URL is missing, malformed, or invalid, or if x-subgraph-name header is missing
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { urlDecoderMiddleware } from './middleware/urlDecoder';
 *
 * const app = express();
 *
 * app.post('/:encodedUrl', urlDecoderMiddleware, async (req, res) => {
 *   const { targetUrl, subgraphName } = req as RequestWithTargetUrl;
 *   // Use decoded URL and subgraph name
 * });
 * ```
 */
export const urlDecoderMiddleware = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  try {
    // Extract encoded URL from path parameter
    const encodedUrl = req.params['encodedUrl'];

    if (!encodedUrl) {
      throw new ProxyError(
        'Target URL is required in path parameter',
        ErrorCodes.INVALID_URL,
        400,
        {
          hint: 'Requests should be sent to /:encodedUrl with x-subgraph-name header',
          example: '/http%3A%2F%2Forders-service%3A4001',
        }
      );
    }

    // Decode URL with error handling
    let targetUrl: string;
    try {
      targetUrl = decodeURIComponent(encodedUrl);
    } catch (decodeError) {
      throw new ProxyError(
        'Invalid URL encoding in path parameter',
        ErrorCodes.INVALID_URL,
        400,
        {
          encodedUrl,
          error: decodeError instanceof Error ? decodeError.message : 'Unknown decode error',
          hint: 'Ensure the URL is properly percent-encoded',
        }
      );
    }

    // Validate decoded URL
    if (!validateUrl(targetUrl)) {
      throw new ProxyError(
        'Invalid target URL format',
        ErrorCodes.INVALID_URL,
        400,
        {
          targetUrl,
          hint: 'URL must be a valid HTTP/HTTPS URL with proper format',
          examples: [
            'http://orders-service:4001',
            'https://api.example.com/graphql',
          ],
        }
      );
    }

    // Extract and validate subgraph name from header
    const subgraphName = extractSubgraphName(req, targetUrl);

    // Attach to request object
    (req as RequestWithTargetUrl).targetUrl = targetUrl;
    (req as RequestWithTargetUrl).subgraphName = subgraphName;

    // Log successful decoding
    logger.debug({
      encodedUrl,
      targetUrl,
      subgraphName,
    }, 'URL decoded successfully');

    next();
  } catch (error) {
    // Forward error to error handler
    next(error);
  }
};

/**
 * Decode URL from path without middleware (utility function)
 *
 * Standalone utility function for decoding and validating URLs
 * outside of middleware context.
 *
 * @param {string} encodedUrl - URL-encoded string
 * @returns {string} Decoded and validated URL
 * @throws {ProxyError} If URL is invalid
 *
 * @example
 * ```typescript
 * const url = decodeTargetUrl('http%3A%2F%2Forders%3A4001');
 * console.log(url); // 'http://orders:4001'
 * ```
 */
export function decodeTargetUrl(encodedUrl: string): string {
  if (!encodedUrl) {
    throw new ProxyError(
      'Encoded URL cannot be empty',
      ErrorCodes.INVALID_URL,
      400
    );
  }

  let targetUrl: string;
  try {
    targetUrl = decodeURIComponent(encodedUrl);
  } catch {
    throw new ProxyError(
      'Failed to decode URL',
      ErrorCodes.INVALID_URL,
      400,
      { encodedUrl }
    );
  }

  if (!validateUrl(targetUrl)) {
    throw new ProxyError(
      'Decoded URL is not valid',
      ErrorCodes.INVALID_URL,
      400,
      { targetUrl }
    );
  }

  return targetUrl;
}
