import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { SubgraphRegistry, SubgraphInfo } from '../../../src/services/SubgraphRegistry';
import * as environment from '../../config/environment';

// Mock axios
vi.mock('axios');
const mockedAxios = vi.mocked(axios);

describe('SubgraphRegistry', () => {
  let registry: SubgraphRegistry;

  beforeEach(() => {
    // Create a fresh instance for each test
    registry = new SubgraphRegistry(1000, 5000);
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up any running intervals
    registry.stopHealthChecks();
  });

  describe('constructor', () => {
    it('should create a registry with default parameters', () => {
      const defaultRegistry = new SubgraphRegistry();
      expect(defaultRegistry).toBeInstanceOf(SubgraphRegistry);
    });

    it('should create a registry with custom parameters', () => {
      const customRegistry = new SubgraphRegistry(2000, 10000);
      expect(customRegistry).toBeInstanceOf(SubgraphRegistry);
    });
  });

  describe('registerSubgraph', () => {
    it('should register a new subgraph without config', () => {
      registry.registerSubgraph('products', 'http://products:4001');

      const subgraph = registry.getSubgraphByName('products');
      expect(subgraph).toBeDefined();
      expect(subgraph?.name).toBe('products');
      expect(subgraph?.url).toBe('http://products:4001');
      expect(subgraph?.isAvailable).toBe(false);
      expect(subgraph?.consecutiveFailures).toBe(0);
      expect(subgraph?.isMocking).toBe(false);
      // Now always uses default config with useLocalSchema=false -> 'apollo-registry'
      expect(subgraph?.schemaSource).toBe('apollo-registry');
    });

    it('should register a new subgraph with config', () => {
      const config = {
        forceMock: false,
        disableMocking: false,
        useLocalSchema: true,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      };

      registry.registerSubgraph('products', 'http://products:4001', config);

      const subgraph = registry.getSubgraphByName('products');
      expect(subgraph).toBeDefined();
      expect(subgraph?.name).toBe('products');
      expect(subgraph?.url).toBe('http://products:4001');
      expect(subgraph?.schemaSource).toBe('local-introspection');
    });

    it('should update existing subgraph when re-registered', () => {
      registry.registerSubgraph('products', 'http://products:4001');
      registry.registerSubgraph('products', 'http://products:4002'); // Different URL

      const subgraph = registry.getSubgraphByName('products');
      expect(subgraph?.url).toBe('http://products:4002'); // URL updated
    });

    it('should update config when re-registered with different config', () => {
      // First register with default config (apollo-registry)
      registry.registerSubgraph('products', 'http://products:4001');

      let subgraph = registry.getSubgraphByName('products');
      expect(subgraph?.schemaSource).toBe('apollo-registry');

      // Then register with useLocalSchema=true
      const config = {
        forceMock: false,
        disableMocking: false,
        useLocalSchema: true,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      };

      registry.registerSubgraph('products', 'http://products:4001', config);

      subgraph = registry.getSubgraphByName('products');
      expect(subgraph?.schemaSource).toBe('local-introspection');
    });

    it('should throw error for empty name', () => {
      expect(() => registry.registerSubgraph('', 'http://test:4001')).toThrow();
    });

    it('should allow undefined or empty URL for mocking-only subgraphs', () => {
      registry.registerSubgraph('test', undefined);
      const subgraph = registry.getSubgraphByName('test');
      expect(subgraph).toBeDefined();
      expect(subgraph?.name).toBe('test');
      expect(subgraph?.url).toBe(undefined); // Converted to empty string for backward compatibility
    });

    it('should not increment count when re-registering', () => {
      expect(registry.getSubgraphCount()).toBe(0);
      registry.registerSubgraph('products', 'http://products:4001');
      expect(registry.getSubgraphCount()).toBe(1);
      registry.registerSubgraph('products', 'http://products:4002'); // Re-register
      expect(registry.getSubgraphCount()).toBe(1); // Count stays the same
    });

    it('should increment subgraph count for new subgraphs', () => {
      expect(registry.getSubgraphCount()).toBe(0);
      registry.registerSubgraph('products', 'http://products:4001');
      expect(registry.getSubgraphCount()).toBe(1);
      registry.registerSubgraph('reviews', 'http://reviews:4002');
      expect(registry.getSubgraphCount()).toBe(2);
    });
  });

  describe('getSubgraphByName', () => {
    it('should return subgraph by name', () => {
      registry.registerSubgraph('products', 'http://products:4001');

      const subgraph = registry.getSubgraphByName('products');
      expect(subgraph?.name).toBe('products');
    });

    it('should return undefined for non-existent subgraph', () => {
      const subgraph = registry.getSubgraphByName('nonexistent');
      expect(subgraph).toBeUndefined();
    });
  });

  describe('getSubgraphByUrl', () => {
    it('should return subgraph by URL', () => {
      registry.registerSubgraph('products', 'http://products:4001');

      const subgraph = registry.getSubgraphByUrl('http://products:4001');
      expect(subgraph?.name).toBe('products');
    });

    it('should return undefined for non-existent URL', () => {
      const subgraph = registry.getSubgraphByUrl('http://nonexistent:4001');
      expect(subgraph).toBeUndefined();
    });
  });

  describe('getAllSubgraphs', () => {
    it('should return empty array when no subgraphs registered', () => {
      expect(registry.getAllSubgraphs()).toEqual([]);
    });

    it('should return all registered subgraphs', () => {
      registry.registerSubgraph('products', 'http://products:4001');
      registry.registerSubgraph('reviews', 'http://reviews:4002');

      const subgraphs = registry.getAllSubgraphs();
      expect(subgraphs).toHaveLength(2);
      expect(subgraphs.map(s => s.name)).toContain('products');
      expect(subgraphs.map(s => s.name)).toContain('reviews');
    });
  });

  describe('isSubgraphAvailable', () => {
    it('should return cached status for registered subgraph', async () => {
      registry.registerSubgraph('products', 'http://products:4001');

      const isAvailable = await registry.isSubgraphAvailable('http://products:4001');
      expect(isAvailable).toBe(false);

      // Should not call axios since it's using cached status
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('should perform health check for unknown subgraph', async () => {
      mockedAxios.post.mockResolvedValueOnce({ status: 200, data: { __typename: 'Query' } });

      const isAvailable = await registry.isSubgraphAvailable('http://unknown:4001');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://unknown:4001',
        expect.objectContaining({ query: 'query { __typename }' }),
        expect.objectContaining({
          headers: expect.objectContaining({ 'content-type': 'application/json', 'x-apollo-operation-name': 'TypenameQuery' }),
          timeout: 5000
        }),
      );
      expect(isAvailable).toBe(true);
    });

    it('should return false for 4xx responses', async () => {
      mockedAxios.post.mockResolvedValueOnce({ status: 400 });

      const isAvailable = await registry.isSubgraphAvailable('http://test:4001');
      expect(isAvailable).toBe(false);
    });

    it('should return false for 5xx responses', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('Server error'));

      const isAvailable = await registry.isSubgraphAvailable('http://test:4001');
      expect(isAvailable).toBe(false);
    });

    it('should return false for network errors', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('Network error'));

      const isAvailable = await registry.isSubgraphAvailable('http://test:4001');
      expect(isAvailable).toBe(false);
    });
  });

  describe('startHealthChecks', () => {
    it('should start periodic health checks', async () => {
      await expect(registry.startHealthChecks()).resolves.not.toThrow();
    });

    it('should throw error if health checks already running', async () => {
      await registry.startHealthChecks();
      await expect(registry.startHealthChecks()).rejects.toThrow('Health checks are already running');
    });

    it('should check all subgraphs periodically', async () => {
      vi.useFakeTimers();

      registry.registerSubgraph('products', 'http://products:4001');
      registry.registerSubgraph('reviews', 'http://reviews:4002');

      mockedAxios.post.mockResolvedValue({ status: 200 });

      await registry.startHealthChecks();

      // Fast-forward time to trigger health check
      await vi.advanceTimersByTimeAsync(1000);

      // Expects 4 calls: 2 from immediate check + 2 from periodic check
      expect(mockedAxios.post).toHaveBeenCalledTimes(4);

      vi.useRealTimers();
    });
  });

  describe('stopHealthChecks', () => {
    it('should stop health checks', async () => {
      await registry.startHealthChecks();
      expect(() => registry.stopHealthChecks()).not.toThrow();
    });

    it('should do nothing if health checks not running', () => {
      expect(() => registry.stopHealthChecks()).not.toThrow();
    });
  });

  describe('unregisterSubgraph', () => {
    it('should remove a registered subgraph', () => {
      registry.registerSubgraph('products', 'http://products:4001');
      expect(registry.getSubgraphCount()).toBe(1);

      const removed = registry.unregisterSubgraph('products');
      expect(removed).toBe(true);
      expect(registry.getSubgraphCount()).toBe(0);
    });

    it('should return false for non-existent subgraph', () => {
      const removed = registry.unregisterSubgraph('nonexistent');
      expect(removed).toBe(false);
    });
  });

  describe('clearAll', () => {
    it('should remove all subgraphs', () => {
      registry.registerSubgraph('products', 'http://products:4001');
      registry.registerSubgraph('reviews', 'http://reviews:4002');
      expect(registry.getSubgraphCount()).toBe(2);

      registry.clearAll();
      expect(registry.getSubgraphCount()).toBe(0);
    });
  });

  describe('shouldPassthroughToSubgraph', () => {
    let passthroughSpy: any;

    beforeEach(() => {
      // Enable passthrough by default for these tests
      passthroughSpy = vi.spyOn(environment, 'isPassthroughEnabled').mockReturnValue(true);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return false when passthrough is disabled globally', async () => {
      // Override to disable passthrough
      passthroughSpy.mockReturnValue(false);

      registry.registerSubgraph('products', 'http://products:4001');

      const result = await registry.shouldPassthroughToSubgraph('products', 'http://products:4001');

      expect(result).toBe(false);
    });

    it('should return false when both name and url are undefined', async () => {
      const result = await registry.shouldPassthroughToSubgraph(undefined, undefined);

      expect(result).toBe(false);
    });

    it('should return false when subgraph not found by name', async () => {
      const result = await registry.shouldPassthroughToSubgraph('nonexistent', undefined);

      expect(result).toBe(false);
    });

    it('should return false when subgraph not found by url', async () => {
      const result = await registry.shouldPassthroughToSubgraph(undefined, 'http://nonexistent:4001');

      expect(result).toBe(false);
    });

    it('should return false when subgraph is mocking', async () => {
      const config = {
        forceMock: true, // Force mocking mode
        disableMocking: false,
        useLocalSchema: false,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      };

      registry.registerSubgraph('products', 'http://products:4001', config);

      // Set subgraph state to mocking
      const healthMonitor = registry.getHealthMonitor();
      await healthMonitor.checkHealth('products');

      const result = await registry.shouldPassthroughToSubgraph('products', undefined);

      expect(result).toBe(false);
    });

    it('should return true when mocking is disabled', async () => {
      const config = {
        forceMock: false,
        disableMocking: true,
        useLocalSchema: false,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      };

      registry.registerSubgraph('products', 'http://products:4001', config);

      // Set subgraph state to mocking
      const healthMonitor = registry.getHealthMonitor();
      await healthMonitor.checkHealth('products');

      const result = await registry.shouldPassthroughToSubgraph('products', undefined);

      expect(result).toBe(true);
    });

    it('should return false when subgraph is unavailable', async () => {
      registry.registerSubgraph('products', 'http://products:4001');

      // Mock subgraph as unavailable
      mockedAxios.post.mockRejectedValue(new Error('Connection refused'));

      const result = await registry.shouldPassthroughToSubgraph('products', undefined);

      expect(result).toBe(false);
    });

    it('should return true when subgraph is available and not mocking', async () => {
      registry.registerSubgraph('products', 'http://products:4001');

      // Mock successful health check
      mockedAxios.post.mockResolvedValue({ status: 200 });

      // Perform health check to update state to healthy
      const healthMonitor = registry.getHealthMonitor();
      await healthMonitor.checkHealth('products');

      const result = await registry.shouldPassthroughToSubgraph('products', undefined);

      expect(result).toBe(true);
    });

    it('should look up subgraph by name when name is provided', async () => {
      registry.registerSubgraph('products', 'http://products:4001');

      // Mock successful health check
      mockedAxios.post.mockResolvedValue({ status: 200 });

      // Perform health check to update state to healthy
      const healthMonitor = registry.getHealthMonitor();
      await healthMonitor.checkHealth('products');

      const result = await registry.shouldPassthroughToSubgraph('products', undefined);

      expect(result).toBe(true);
    });

    it('should look up subgraph by url when only url is provided', async () => {
      registry.registerSubgraph('products', 'http://products:4001');

      // Mock successful health check
      mockedAxios.post.mockResolvedValue({ status: 200 });

      // Perform health check to update state to healthy
      const healthMonitor = registry.getHealthMonitor();
      await healthMonitor.checkHealth('products');

      const result = await registry.shouldPassthroughToSubgraph(undefined, 'http://products:4001');

      expect(result).toBe(true);
    });

    it('should prefer name lookup over url when both are provided', async () => {
      registry.registerSubgraph('products', 'http://products:4001');
      registry.registerSubgraph('reviews', 'http://reviews:4002');

      // Mock successful health check
      mockedAxios.post.mockResolvedValue({ status: 200 });

      // Perform health check to update products state to healthy
      const healthMonitor = registry.getHealthMonitor();
      await healthMonitor.checkHealth('products');

      // Name should take precedence
      const result = await registry.shouldPassthroughToSubgraph('products', 'http://reviews:4002');

      expect(result).toBe(true);
      // Verify it used products URL, not reviews
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://products:4001',
        expect.objectContaining({ query: 'query { __typename }' }),
        expect.objectContaining({
          headers: expect.objectContaining({ 'content-type': 'application/json', 'x-apollo-operation-name': 'TypenameQuery' }),
          timeout: 5000
        })
      );
    });

    it('should handle subgraph with undefined url', async () => {
      registry.registerSubgraph('products', undefined);

      const result = await registry.shouldPassthroughToSubgraph('products', undefined);

      // Should return false because subgraph has no URL
      expect(result).toBe(false);
    });

    it('should return true for healthy subgraph after health check', async () => {
      const config = {
        forceMock: false,
        disableMocking: false,
        useLocalSchema: true,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      };

      registry.registerSubgraph('products', 'http://products:4001', config);

      // Simulate successful health check
      mockedAxios.post.mockResolvedValue({ status: 200 });
      const healthMonitor = registry.getHealthMonitor();
      await healthMonitor.checkHealth('products');

      const result = await registry.shouldPassthroughToSubgraph('products', undefined);

      expect(result).toBe(true);
    });

    it('should return false for unhealthy subgraph after failed health check', async () => {
      registry.registerSubgraph('products', 'http://products:4001');

      // Simulate failed health check
      mockedAxios.post.mockRejectedValue(new Error('Connection timeout'));
      const healthMonitor = registry.getHealthMonitor();
      await healthMonitor.checkHealth('products');

      const result = await registry.shouldPassthroughToSubgraph('products', undefined);

      expect(result).toBe(false);
    });

    it('should check availability even if cached state exists', async () => {
      registry.registerSubgraph('products', 'http://products:4001');

      // Mock successful health check
      mockedAxios.post.mockResolvedValue({ status: 200 });

      // Perform health check to mark subgraph as healthy
      const healthMonitor = registry.getHealthMonitor();
      await healthMonitor.checkHealth('products');

      const firstCallCount = mockedAxios.post.mock.calls.length;

      // First call to shouldPassthroughToSubgraph - uses cached state
      const result1 = await registry.shouldPassthroughToSubgraph('products', undefined);
      expect(result1).toBe(true);

      // Second call to shouldPassthroughToSubgraph - still uses cached state (no new axios call)
      const result2 = await registry.shouldPassthroughToSubgraph('products', undefined);
      expect(result2).toBe(true);

      // Verify no additional axios calls were made (uses cached availability)
      expect(mockedAxios.post.mock.calls.length).toBe(firstCallCount);
    });
  });

  describe('health check tracking', () => {
    it('should update lastCheck timestamp', async () => {
      vi.useFakeTimers();
      const now = new Date('2025-01-01T00:00:00Z');
      vi.setSystemTime(now);

      registry.registerSubgraph('products', 'http://products:4001');
      mockedAxios.post.mockResolvedValue({ status: 200 });

      await registry.startHealthChecks();
      await vi.advanceTimersByTimeAsync(1000);

      const subgraph = registry.getSubgraphByName('products');
      expect(subgraph?.lastCheck.getTime()).toBeGreaterThan(now.getTime());

      vi.useRealTimers();
    });

    it('should increment consecutive failures on unhealthy check', async () => {
      vi.useFakeTimers();

      registry.registerSubgraph('products', 'http://products:4001');
      mockedAxios.post.mockRejectedValue(new Error('Connection refused'));

      await registry.startHealthChecks();

      // First check (after immediate + first periodic)
      await vi.advanceTimersByTimeAsync(1000);
      let subgraph = registry.getSubgraphByName('products');
      expect(subgraph?.consecutiveFailures).toBe(2);
      expect(subgraph?.isAvailable).toBe(false);

      // Second check (after another periodic)
      await vi.advanceTimersByTimeAsync(1000);
      subgraph = registry.getSubgraphByName('products');
      expect(subgraph?.consecutiveFailures).toBe(3);

      vi.useRealTimers();
    });

    it('should reset consecutive failures on successful check', async () => {
      vi.useFakeTimers();

      registry.registerSubgraph('products', 'http://products:4001');

      // Both immediate and first periodic check fail
      mockedAxios.post.mockRejectedValue(new Error('Connection refused'));
      await registry.startHealthChecks();
      await vi.advanceTimersByTimeAsync(1000);

      let subgraph = registry.getSubgraphByName('products');
      expect(subgraph?.consecutiveFailures).toBe(2);

      // Next check succeeds
      mockedAxios.post.mockResolvedValue({ status: 200 });
      await vi.advanceTimersByTimeAsync(1000);

      subgraph = registry.getSubgraphByName('products');
      expect(subgraph?.consecutiveFailures).toBe(0);
      expect(subgraph?.isAvailable).toBe(true);

      vi.useRealTimers();
    });
  });
});
