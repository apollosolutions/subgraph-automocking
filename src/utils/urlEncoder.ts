/**
 * URL Encoding Utilities
 *
 * Provides utilities for encoding and decoding URLs for use in the mocking
 * proxy's path-based routing system. These utilities ensure URLs are safely
 * encoded for transmission as path parameters.
 */

/**
 * Encode a URL for use as a path parameter
 *
 * Encodes a full URL using percent-encoding (URI encoding) to make it safe
 * for use as a path parameter in HTTP requests. This allows the proxy to
 * receive target URLs as part of the request path.
 *
 * @param {string} url - URL to encode
 * @returns {string} Percent-encoded URL string
 *
 * @throws {Error} If URL is empty or invalid
 *
 * @example
 * ```typescript
 * const encoded = encodeTargetUrl('http://orders-service:4001');
 * console.log(encoded); // 'http%3A%2F%2Forders-service%3A4001'
 *
 * // Use in request
 * fetch(`http://proxy:3000/${encoded}`, {
 *   method: 'POST',
 *   body: JSON.stringify({ query: '...' })
 * });
 * ```
 */
export function encodeTargetUrl(url: string): string {
  if (!url || typeof url !== 'string') {
    throw new Error('URL must be a non-empty string');
  }

  // Validate URL format
  try {
    new URL(url);
  } catch {
    throw new Error(`Invalid URL format: ${url}`);
  }

  // Use built-in encodeURIComponent for proper encoding
  return encodeURIComponent(url);
}

/**
 * Decode a URL from a path parameter
 *
 * Decodes a percent-encoded URL back to its original form. This is the
 * inverse operation of encodeTargetUrl.
 *
 * @param {string} encodedUrl - Percent-encoded URL string
 * @returns {string} Decoded URL
 *
 * @throws {Error} If decoding fails or result is invalid
 *
 * @example
 * ```typescript
 * const decoded = decodeTargetUrl('http%3A%2F%2Forders-service%3A4001');
 * console.log(decoded); // 'http://orders-service:4001'
 * ```
 */
export function decodeTargetUrl(encodedUrl: string): string {
  if (!encodedUrl || typeof encodedUrl !== 'string') {
    throw new Error('Encoded URL must be a non-empty string');
  }

  try {
    const decoded = decodeURIComponent(encodedUrl);

    // Validate that decoded result is a valid URL
    new URL(decoded);

    return decoded;
  } catch (error) {
    throw new Error(
      `Failed to decode URL: ${encodedUrl}. ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

/**
 * Build a proxy URL with encoded target
 *
 * Constructs a complete proxy URL by combining the proxy base URL with
 * an encoded target URL. Useful for building request URLs programmatically.
 *
 * @param {string} proxyBaseUrl - Base URL of the proxy server (e.g., 'http://proxy:3000')
 * @param {string} targetUrl - Target URL to encode and append
 * @returns {string} Complete proxy URL with encoded target
 *
 * @example
 * ```typescript
 * const proxyUrl = buildProxyUrl(
 *   'http://mocking-proxy:3000',
 *   'http://orders-service:4001'
 * );
 * console.log(proxyUrl);
 * // 'http://mocking-proxy:3000/http%3A%2F%2Forders-service%3A4001'
 * ```
 */
export function buildProxyUrl(proxyBaseUrl: string, targetUrl: string): string {
  if (!proxyBaseUrl || !targetUrl) {
    throw new Error('Both proxyBaseUrl and targetUrl are required');
  }

  // Remove trailing slash from base URL if present
  const baseUrl = proxyBaseUrl.replace(/\/$/, '');

  // Encode target URL
  const encodedTarget = encodeTargetUrl(targetUrl);

  return `${baseUrl}/${encodedTarget}`;
}

/**
 * Extract target URL from proxy request path
 *
 * Extracts and decodes the target URL from a proxy request path.
 * Handles both full URLs and path-only formats.
 *
 * @param {string} path - Request path (e.g., '/http%3A%2F%2Forders%3A4001')
 * @returns {string} Decoded target URL
 *
 * @throws {Error} If path is invalid or doesn't contain encoded URL
 *
 * @example
 * ```typescript
 * const targetUrl = extractTargetUrl('/http%3A%2F%2Forders%3A4001');
 * console.log(targetUrl); // 'http://orders:4001'
 * ```
 */
export function extractTargetUrl(path: string): string {
  if (!path || typeof path !== 'string') {
    throw new Error('Path must be a non-empty string');
  }

  // Remove leading slash if present
  const cleanPath = path.replace(/^\//, '');

  if (!cleanPath) {
    throw new Error('Path does not contain encoded URL');
  }

  // Decode the path
  return decodeTargetUrl(cleanPath);
}

/**
 * Validate encoded URL format
 *
 * Checks if a string appears to be a valid encoded URL without
 * attempting to decode it (useful for pre-validation).
 *
 * @param {string} encodedUrl - String to validate
 * @returns {boolean} True if string appears to be a valid encoded URL
 *
 * @example
 * ```typescript
 * isValidEncodedUrl('http%3A%2F%2Forders%3A4001'); // true
 * isValidEncodedUrl('not-encoded'); // false
 * isValidEncodedUrl(''); // false
 * ```
 */
export function isValidEncodedUrl(encodedUrl: string): boolean {
  if (!encodedUrl || typeof encodedUrl !== 'string') {
    return false;
  }

  try {
    // Attempt to decode
    const decoded = decodeURIComponent(encodedUrl);

    // Check if decoded string is a valid URL
    new URL(decoded);

    return true;
  } catch {
    return false;
  }
}

/**
 * Batch encode multiple URLs
 *
 * Encodes an array of URLs in a single operation, filtering out
 * any invalid URLs and returning results with error information.
 *
 * @param {string[]} urls - Array of URLs to encode
 * @returns {Array<{url: string, encoded: string, error?: string}>} Encoding results
 *
 * @example
 * ```typescript
 * const results = batchEncodeUrls([
 *   'http://orders:4001',
 *   'http://products:4002',
 *   'invalid-url'
 * ]);
 * // [
 * //   { url: 'http://orders:4001', encoded: 'http%3A%2F%2F...' },
 * //   { url: 'http://products:4002', encoded: 'http%3A%2F%2F...' },
 * //   { url: 'invalid-url', error: 'Invalid URL format: invalid-url' }
 * // ]
 * ```
 */
export function batchEncodeUrls(
  urls: string[]
): Array<{ url: string; encoded?: string; error?: string }> {
  return urls.map(url => {
    try {
      return {
        url,
        encoded: encodeTargetUrl(url),
      };
    } catch (error) {
      return {
        url,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
}
