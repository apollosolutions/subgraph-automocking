import { describe, it, expect } from 'vitest';
import {
  encodeTargetUrl,
  decodeTargetUrl,
  buildProxyUrl,
  extractTargetUrl,
  isValidEncodedUrl,
  batchEncodeUrls,
} from '../../../src/utils/urlEncoder';

/**
 * URL Encoder Utilities Tests
 *
 * Tests URL encoding, decoding, and validation utilities.
 */

describe('URL Encoder Utilities', () => {
  describe('encodeTargetUrl', () => {
    it('should encode HTTP URL correctly', () => {
      const url = 'http://orders-service:4001';
      const encoded = encodeTargetUrl(url);

      expect(encoded).toBe(encodeURIComponent(url));
      expect(encoded).toContain('%3A'); // colon
      expect(encoded).toContain('%2F'); // slash
    });

    it('should encode HTTPS URL correctly', () => {
      const url = 'https://api.example.com/graphql';
      const encoded = encodeTargetUrl(url);

      expect(encoded).toBe(encodeURIComponent(url));
    });

    it('should throw error for empty string', () => {
      expect(() => encodeTargetUrl('')).toThrow('URL must be a non-empty string');
    });

    it('should throw error for non-string input', () => {
      expect(() => encodeTargetUrl(null as any)).toThrow('URL must be a non-empty string');
      expect(() => encodeTargetUrl(undefined as any)).toThrow('URL must be a non-empty string');
      expect(() => encodeTargetUrl(123 as any)).toThrow('URL must be a non-empty string');
    });

    it('should throw error for invalid URL format', () => {
      expect(() => encodeTargetUrl('not-a-url')).toThrow('Invalid URL format');
      expect(() => encodeTargetUrl('just some text')).toThrow('Invalid URL format');
    });

    it('should encode URL with query parameters', () => {
      const url = 'http://api.example.com/graphql?debug=true&verbose=1';
      const encoded = encodeTargetUrl(url);

      expect(encoded).toBe(encodeURIComponent(url));
    });

    it('should encode URL with fragment', () => {
      const url = 'http://api.example.com/graphql#section';
      const encoded = encodeTargetUrl(url);

      expect(encoded).toBe(encodeURIComponent(url));
    });
  });

  describe('decodeTargetUrl', () => {
    it('should decode encoded URL correctly', () => {
      const url = 'http://orders-service:4001';
      const encoded = encodeURIComponent(url);
      const decoded = decodeTargetUrl(encoded);

      expect(decoded).toBe(url);
    });

    it('should throw error for empty string', () => {
      expect(() => decodeTargetUrl('')).toThrow('Encoded URL must be a non-empty string');
    });

    it('should throw error for non-string input', () => {
      expect(() => decodeTargetUrl(null as any)).toThrow();
      expect(() => decodeTargetUrl(undefined as any)).toThrow();
    });

    it('should throw error for invalid encoding', () => {
      expect(() => decodeTargetUrl('%ZZ%invalid')).toThrow('Failed to decode URL');
    });

    it('should throw error if decoded result is not valid URL', () => {
      const encoded = encodeURIComponent('not-a-url');
      expect(() => decodeTargetUrl(encoded)).toThrow('Failed to decode URL');
    });

    it('should decode URL with query parameters', () => {
      const url = 'http://api.example.com/graphql?key=value';
      const encoded = encodeURIComponent(url);
      const decoded = decodeTargetUrl(encoded);

      expect(decoded).toBe(url);
    });

    it('should be inverse of encodeTargetUrl', () => {
      const url = 'http://orders-service:4001/graphql';
      expect(decodeTargetUrl(encodeTargetUrl(url))).toBe(url);
    });
  });

  describe('buildProxyUrl', () => {
    it('should build proxy URL correctly', () => {
      const proxyUrl = buildProxyUrl(
        'http://mocking-proxy:3000',
        'http://orders-service:4001'
      );

      expect(proxyUrl).toContain('http://mocking-proxy:3000/');
      expect(proxyUrl).toContain(encodeURIComponent('http://orders-service:4001'));
    });

    it('should remove trailing slash from base URL', () => {
      const proxyUrl = buildProxyUrl(
        'http://mocking-proxy:3000/',
        'http://orders-service:4001'
      );

      expect(proxyUrl).not.toContain('//http');
      expect(proxyUrl).toContain('http://mocking-proxy:3000/http%3A');
    });

    it('should throw error if base URL is missing', () => {
      expect(() => buildProxyUrl('', 'http://orders:4001')).toThrow();
    });

    it('should throw error if target URL is missing', () => {
      expect(() => buildProxyUrl('http://proxy:3000', '')).toThrow();
    });

    it('should handle HTTPS base URLs', () => {
      const proxyUrl = buildProxyUrl(
        'https://mocking-proxy.example.com',
        'http://orders-service:4001'
      );

      expect(proxyUrl).toContain('https://mocking-proxy.example.com/');
    });

    it('should encode complex target URLs', () => {
      const proxyUrl = buildProxyUrl(
        'http://proxy:3000',
        'http://api.example.com/graphql?debug=true'
      );

      expect(proxyUrl).toContain(encodeURIComponent('http://api.example.com/graphql?debug=true'));
    });
  });

  describe('extractTargetUrl', () => {
    it('should extract URL from path with leading slash', () => {
      const path = '/' + encodeURIComponent('http://orders:4001');
      const url = extractTargetUrl(path);

      expect(url).toBe('http://orders:4001');
    });

    it('should extract URL from path without leading slash', () => {
      const path = encodeURIComponent('http://orders:4001');
      const url = extractTargetUrl(path);

      expect(url).toBe('http://orders:4001');
    });

    it('should throw error for empty path', () => {
      expect(() => extractTargetUrl('')).toThrow();
    });

    it('should throw error for path with only slash', () => {
      expect(() => extractTargetUrl('/')).toThrow();
    });

    it('should throw error for invalid encoding in path', () => {
      expect(() => extractTargetUrl('/%ZZ')).toThrow();
    });

    it('should handle complex paths', () => {
      const url = 'http://api.example.com/graphql?key=value';
      const path = '/' + encodeURIComponent(url);
      const extracted = extractTargetUrl(path);

      expect(extracted).toBe(url);
    });
  });

  describe('isValidEncodedUrl', () => {
    it('should return true for valid encoded HTTP URL', () => {
      const encoded = encodeURIComponent('http://orders:4001');
      expect(isValidEncodedUrl(encoded)).toBe(true);
    });

    it('should return true for valid encoded HTTPS URL', () => {
      const encoded = encodeURIComponent('https://api.example.com');
      expect(isValidEncodedUrl(encoded)).toBe(true);
    });

    it('should return false for empty string', () => {
      expect(isValidEncodedUrl('')).toBe(false);
    });

    it('should return false for non-string input', () => {
      expect(isValidEncodedUrl(null as any)).toBe(false);
      expect(isValidEncodedUrl(undefined as any)).toBe(false);
    });

    it('should return false for invalid encoding', () => {
      expect(isValidEncodedUrl('%ZZ')).toBe(false);
    });

    it('should return false for encoded non-URL', () => {
      const encoded = encodeURIComponent('not-a-url');
      expect(isValidEncodedUrl(encoded)).toBe(false);
    });

    it('should return false for unencoded URL', () => {
      // Note: 'http://orders:4001' can be decoded (even though it's not encoded)
      // So we need a truly invalid unencoded string
      expect(isValidEncodedUrl('not encoded at all')).toBe(false);
    });

    it('should validate complex URLs', () => {
      const url = 'http://api.example.com/graphql?debug=true#section';
      const encoded = encodeURIComponent(url);
      expect(isValidEncodedUrl(encoded)).toBe(true);
    });
  });

  describe('batchEncodeUrls', () => {
    it('should encode multiple URLs successfully', () => {
      const urls = [
        'http://orders:4001',
        'http://products:4002',
        'http://users:4003',
      ];

      const results = batchEncodeUrls(urls);

      expect(results).toHaveLength(3);
      results.forEach((result, index) => {
        expect(result.url).toBe(urls[index]);
        expect(result.encoded).toBeDefined();
        expect(result.error).toBeUndefined();
      });
    });

    it('should handle mix of valid and invalid URLs', () => {
      const urls = [
        'http://orders:4001',
        'not-a-url',
        'http://products:4002',
      ];

      const results = batchEncodeUrls(urls);

      expect(results).toHaveLength(3);
      expect(results[0].encoded).toBeDefined();
      expect(results[0].error).toBeUndefined();
      expect(results[1].encoded).toBeUndefined();
      expect(results[1].error).toBeDefined();
      expect(results[2].encoded).toBeDefined();
      expect(results[2].error).toBeUndefined();
    });

    it('should handle empty array', () => {
      const results = batchEncodeUrls([]);
      expect(results).toHaveLength(0);
    });

    it('should include error messages for invalid URLs', () => {
      const urls = ['not-a-url', 'also-invalid'];
      const results = batchEncodeUrls(urls);

      results.forEach(result => {
        expect(result.error).toBeDefined();
        expect(result.error).toContain('Invalid URL format');
      });
    });

    it('should encode complex URLs in batch', () => {
      const urls = [
        'http://api.example.com/graphql?debug=true',
        'https://secure.example.com:443/api',
        'http://localhost:4001/health',
      ];

      const results = batchEncodeUrls(urls);

      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.encoded).toBeDefined();
        expect(result.error).toBeUndefined();
      });
    });
  });

  describe('Round-trip Encoding/Decoding', () => {
    it('should maintain URL integrity through encode/decode cycle', () => {
      const urls = [
        'http://orders:4001',
        'http://products:4002/graphql',
        'https://api.example.com:8080/v1/graphql?debug=true',
        'http://localhost:4001',
      ];

      urls.forEach(url => {
        const encoded = encodeTargetUrl(url);
        const decoded = decodeTargetUrl(encoded);
        expect(decoded).toBe(url);
      });
    });

    it('should maintain proxy URL integrity', () => {
      const baseUrl = 'http://proxy:3000';
      const targetUrl = 'http://orders:4001/graphql';

      const proxyUrl = buildProxyUrl(baseUrl, targetUrl);
      const extracted = extractTargetUrl(proxyUrl.replace(baseUrl, ''));

      expect(extracted).toBe(targetUrl);
    });
  });
});
