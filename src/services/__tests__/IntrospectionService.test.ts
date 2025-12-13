import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IntrospectionService } from '../IntrospectionService';
import axios from 'axios';

vi.mock('axios');

// Federation introspection response with SDL
const createCompleteIntrospectionResponse = () => ({
  data: {
    data: {
      _service: {
        sdl: `
          type Query {
            test: String
          }
        `.trim(),
      },
    },
  },
});

describe('IntrospectionService', () => {
  let service: IntrospectionService;
  const mockEndpoint = 'http://localhost:4001/graphql';

  beforeEach(() => {
    service = new IntrospectionService();
    vi.clearAllMocks();
  });

  describe('introspect', () => {
    it('should successfully introspect schema on first attempt', async () => {
      const mockIntrospectionResponse = createCompleteIntrospectionResponse();

      vi.mocked(axios.post).mockResolvedValue(mockIntrospectionResponse);

      const result = await service.introspect(mockEndpoint, { maxRetries: 3, retryDelayMs: 100 });

      expect(result.success).toBe(true);
      expect(result.sdl).toBeDefined();
      expect(result.error).toBeUndefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and succeed', async () => {
      const mockIntrospectionResponse = createCompleteIntrospectionResponse();

      vi.mocked(axios.post)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(mockIntrospectionResponse);

      const result = await service.introspect(mockEndpoint, { maxRetries: 3, retryDelayMs: 10 });

      expect(result.success).toBe(true);
      expect(axios.post).toHaveBeenCalledTimes(3);
    });

    it('should fail after max retries exhausted', async () => {
      vi.mocked(axios.post).mockRejectedValue(new Error('Connection refused'));

      const result = await service.introspect(mockEndpoint, { maxRetries: 2, retryDelayMs: 10 });

      expect(result.success).toBe(false);
      expect(result.sdl).toBeUndefined();
      expect(result.error).toContain('Connection refused');
      expect(axios.post).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should handle ECONNREFUSED error', async () => {
      const error: any = new Error('Connection refused');
      error.code = 'ECONNREFUSED';

      vi.mocked(axios.post).mockRejectedValue(error);

      const result = await service.introspect(mockEndpoint, { maxRetries: 0, retryDelayMs: 10 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection refused');
    });

    it('should handle timeout error', async () => {
      const error: any = new Error('Timeout');
      error.code = 'ETIMEDOUT';
      error.isAxiosError = true;

      vi.mocked(axios.post).mockRejectedValue(error);

      const result = await service.introspect(mockEndpoint, { maxRetries: 0, retryDelayMs: 10 });

      expect(result.success).toBe(false);
      expect(result.error?.toLowerCase()).toContain('timeout');
    });

    it('should handle HTTP error responses', async () => {
      const error: any = new Error('HTTP Error');
      error.isAxiosError = true;
      error.response = {
        status: 500,
        statusText: 'Internal Server Error',
      };

      vi.mocked(axios.post).mockRejectedValue(error);

      const result = await service.introspect(mockEndpoint, { maxRetries: 0, retryDelayMs: 10 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('500');
    });

    it('should handle invalid introspection response', async () => {
      vi.mocked(axios.post).mockResolvedValue({ data: {} });

      const result = await service.introspect(mockEndpoint, { maxRetries: 0, retryDelayMs: 10 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid introspection response');
    });

    it('should include introspection query in request', async () => {
      const mockIntrospectionResponse = createCompleteIntrospectionResponse();

      vi.mocked(axios.post).mockResolvedValue(mockIntrospectionResponse);

      await service.introspect(mockEndpoint, { maxRetries: 0, retryDelayMs: 10 });

      expect(axios.post).toHaveBeenCalledWith(
        mockEndpoint,
        expect.objectContaining({
          query: expect.stringContaining('_service'),
        }),
        expect.objectContaining({
          timeout: 10000,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should handle ECONNABORTED error', async () => {
      const error: any = new Error('Connection aborted');
      error.code = 'ECONNABORTED';
      error.isAxiosError = true;

      vi.mocked(axios.post).mockRejectedValue(error);

      const result = await service.introspect(mockEndpoint, { maxRetries: 0, retryDelayMs: 10 });

      expect(result.success).toBe(false);
      expect(result.error?.toLowerCase()).toContain('timeout');
    });

    it('should handle AxiosError without response but with message', async () => {
      const error: any = new Error('Custom axios error');
      error.isAxiosError = true;
      // No response, no specific error code

      vi.mocked(axios.post).mockRejectedValue(error);

      const result = await service.introspect(mockEndpoint, { maxRetries: 0, retryDelayMs: 10 });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Custom axios error');
    });

    it('should handle unknown error types', async () => {
      // Not an Error instance, not an AxiosError
      vi.mocked(axios.post).mockRejectedValue('string error');

      const result = await service.introspect(mockEndpoint, { maxRetries: 0, retryDelayMs: 10 });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });

    it('should handle null error', async () => {
      vi.mocked(axios.post).mockRejectedValue(null);

      const result = await service.introspect(mockEndpoint, { maxRetries: 0, retryDelayMs: 10 });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });

    it('should use default retry configuration when not provided', async () => {
      const mockIntrospectionResponse = createCompleteIntrospectionResponse();
      vi.mocked(axios.post).mockResolvedValue(mockIntrospectionResponse);

      const result = await service.introspect(mockEndpoint);

      expect(result.success).toBe(true);
      expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it('should handle ECONNREFUSED with isAxiosError flag instead of instanceof', async () => {
      const error = {
        isAxiosError: true,
        code: 'ECONNREFUSED',
        message: 'Connection refused',
      } as any;

      vi.mocked(axios.post).mockRejectedValue(error);

      const result = await service.introspect(mockEndpoint, { maxRetries: 0, retryDelayMs: 10 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection refused - endpoint may not be running');
    });

    it('should handle plain Error instance (not AxiosError)', async () => {
      const error = new Error('Plain error message');

      vi.mocked(axios.post).mockRejectedValue(error);

      const result = await service.introspect(mockEndpoint, { maxRetries: 0, retryDelayMs: 10 });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Plain error message');
    });

    it('should include custom headers in introspection request', async () => {
      const mockIntrospectionResponse = createCompleteIntrospectionResponse();
      const customHeaders = {
        'authorization': 'Bearer test-token-123',
        'x-api-key': 'api-key-456',
        'x-custom-header': 'custom-value',
      };

      vi.mocked(axios.post).mockResolvedValue(mockIntrospectionResponse);

      await service.introspect(mockEndpoint, { maxRetries: 0, retryDelayMs: 10 }, customHeaders);

      expect(axios.post).toHaveBeenCalledWith(
        mockEndpoint,
        expect.objectContaining({
          query: expect.stringContaining('_service'),
        }),
        expect.objectContaining({
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
            'authorization': 'Bearer test-token-123',
            'x-api-key': 'api-key-456',
            'x-custom-header': 'custom-value',
          },
        })
      );
    });

    it('should allow custom headers to override Content-Type', async () => {
      const mockIntrospectionResponse = createCompleteIntrospectionResponse();
      const customHeaders = {
        'Content-Type': 'application/graphql', // Override default
      };

      vi.mocked(axios.post).mockResolvedValue(mockIntrospectionResponse);

      await service.introspect(mockEndpoint, { maxRetries: 0, retryDelayMs: 10 }, customHeaders);

      expect(axios.post).toHaveBeenCalledWith(
        mockEndpoint,
        expect.any(Object),
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/graphql',
          },
        })
      );
    });

    it('should work without custom headers (backwards compatible)', async () => {
      const mockIntrospectionResponse = createCompleteIntrospectionResponse();

      vi.mocked(axios.post).mockResolvedValue(mockIntrospectionResponse);

      await service.introspect(mockEndpoint, { maxRetries: 0, retryDelayMs: 10 });

      expect(axios.post).toHaveBeenCalledWith(
        mockEndpoint,
        expect.any(Object),
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/json',
          },
        })
      );
    });

    it('should retry with custom headers on all attempts', async () => {
      const mockIntrospectionResponse = createCompleteIntrospectionResponse();
      const customHeaders = {
        'authorization': 'Bearer retry-token',
      };

      vi.mocked(axios.post)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(mockIntrospectionResponse);

      await service.introspect(mockEndpoint, { maxRetries: 2, retryDelayMs: 10 }, customHeaders);

      // Verify all attempts included custom headers
      expect(axios.post).toHaveBeenCalledTimes(2);
      expect(axios.post).toHaveBeenNthCalledWith(
        1,
        mockEndpoint,
        expect.any(Object),
        expect.objectContaining({
          headers: expect.objectContaining({
            'authorization': 'Bearer retry-token',
          }),
        })
      );
      expect(axios.post).toHaveBeenNthCalledWith(
        2,
        mockEndpoint,
        expect.any(Object),
        expect.objectContaining({
          headers: expect.objectContaining({
            'authorization': 'Bearer retry-token',
          }),
        })
      );
    });
  });
});
