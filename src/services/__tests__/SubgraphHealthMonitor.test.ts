import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import { SubgraphHealthMonitor } from '../SubgraphHealthMonitor';
import { SubgraphConfigItem } from '../../config/subgraphConfig';

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

describe('SubgraphHealthMonitor', () => {
  let monitor: SubgraphHealthMonitor;

  beforeEach(() => {
    mockedAxios.post.mockReset();
    monitor = new SubgraphHealthMonitor(mockedAxios as any);
  });

  afterEach(() => {
    monitor.shutdown();
  });

  describe('registerSubgraph', () => {
    it('should register a subgraph with default state', () => {
      const config: SubgraphConfigItem = {
        forceMock: false,
        disableMocking: false,
        useLocalSchema: true,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      };

      monitor.registerSubgraph('products', 'http://products:4001', config);

      const state = monitor.getState('products');

      expect(state).toBeDefined();
      expect(state?.name).toBe('products');
      expect(state?.url).toBe('http://products:4001');
      expect(state?.status).toBe('unknown');
      expect(state?.isHealthy).toBe(false);
      expect(state?.consecutiveFailures).toBe(0);
      expect(state?.schemaSource).toBe('local-introspection');
    });

    it('should set forceMock in initial state', () => {
      const config: SubgraphConfigItem = {
        forceMock: true,
        disableMocking: false,
        useLocalSchema: false,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      };

      monitor.registerSubgraph('reviews', 'http://reviews:4002', config);

      const state = monitor.getState('reviews');

      expect(state?.isMocking).toBe(true);
    });

    it('should use apollo-registry when useLocalSchema is false', () => {
      const config: SubgraphConfigItem = {
        forceMock: false,
        disableMocking: false,
        useLocalSchema: false,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      };

      monitor.registerSubgraph('users', 'http://users:4003', config);

      const state = monitor.getState('users');

      expect(state?.schemaSource).toBe('apollo-registry');
    });
  });

  describe('checkHealth', () => {
    it('should mark subgraph as healthy on successful health check', async () => {
      const config: SubgraphConfigItem = {
        forceMock: false,
        disableMocking: false,
        useLocalSchema: true,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      };

      monitor.registerSubgraph('products', 'http://products:4001', config);

      mockedAxios.post.mockResolvedValue({
        status: 200,
      } as any);

      const result = await monitor.checkHealth('products');

      expect(result.isHealthy).toBe(true);

      const state = monitor.getState('products');
      expect(state?.isHealthy).toBe(true);
      expect(state?.status).toBe('available');
      expect(state?.consecutiveFailures).toBe(0);
    });

    it('should increment consecutive failures on failed health check', async () => {
      const config: SubgraphConfigItem = {
        forceMock: false,
        disableMocking: false,
        useLocalSchema: true,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      };

      monitor.registerSubgraph('products', 'http://products:4001', config);

      mockedAxios.post.mockResolvedValue({
        status: 503,
      } as any);

      await monitor.checkHealth('products');

      const state = monitor.getState('products');
      expect(state?.isHealthy).toBe(false);
      expect(state?.consecutiveFailures).toBe(1);
    });

    it('should switch to mocking after maxRetries failures', async () => {
      const config: SubgraphConfigItem = {
        forceMock: false,
        disableMocking: false,
        useLocalSchema: true,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      };

      monitor.registerSubgraph('products', 'http://products:4001', config);

      mockedAxios.post.mockResolvedValue({
        status: 503,
      } as any);

      // Fail 3 times
      await monitor.checkHealth('products');
      await monitor.checkHealth('products');
      await monitor.checkHealth('products');

      const state = monitor.getState('products');
      expect(state?.consecutiveFailures).toBe(3);
      expect(state?.status).toBe('mocking');
      expect(state?.isMocking).toBe(true);
    });

    it('should not mock when disableMocking is true', async () => {
      const config: SubgraphConfigItem = {
        forceMock: false,
        disableMocking: true,
        useLocalSchema: true,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      };

      monitor.registerSubgraph('products', 'http://products:4001', config);

      mockedAxios.post.mockResolvedValue({
        status: 503,
      } as any);

      await monitor.checkHealth('products');
      await monitor.checkHealth('products');
      await monitor.checkHealth('products');

      const state = monitor.getState('products');
      expect(state?.isMocking).toBe(false);
      expect(state?.status).toBe('unavailable');
    });

    it('should reset failures when health check succeeds', async () => {
      const config: SubgraphConfigItem = {
        forceMock: false,
        disableMocking: false,
        useLocalSchema: true,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      };

      monitor.registerSubgraph('products', 'http://products:4001', config);

      // Fail twice
      mockedAxios.post.mockResolvedValue({
        status: 503,
      } as any);

      await monitor.checkHealth('products');
      await monitor.checkHealth('products');

      // Then succeed
      mockedAxios.post.mockResolvedValue({
        status: 200,
      } as any);

      await monitor.checkHealth('products');

      const state = monitor.getState('products');
      expect(state?.consecutiveFailures).toBe(0);
      expect(state?.isHealthy).toBe(true);
      expect(state?.status).toBe('available');
    });

    it('should throw error for unregistered subgraph', async () => {
      await expect(monitor.checkHealth('nonexistent')).rejects.toThrow('not registered');
    });
  });

  describe('getState', () => {
    it('should return undefined for unregistered subgraph', () => {
      const state = monitor.getState('nonexistent');
      expect(state).toBeUndefined();
    });

    it('should return current state for registered subgraph', () => {
      const config: SubgraphConfigItem = {
        forceMock: false,
        disableMocking: false,
        useLocalSchema: false,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      };

      monitor.registerSubgraph('products', 'http://products:4001', config);

      const state = monitor.getState('products');
      expect(state).toBeDefined();
      expect(state?.name).toBe('products');
    });
  });

  describe('getAllStates', () => {
    it('should return empty array when no subgraphs registered', () => {
      const states = monitor.getAllStates();
      expect(states).toEqual([]);
    });

    it('should return all registered subgraph states', () => {
      const config: SubgraphConfigItem = {
        forceMock: false,
        disableMocking: false,
        useLocalSchema: false,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      };

      monitor.registerSubgraph('products', 'http://products:4001', config);
      monitor.registerSubgraph('reviews', 'http://reviews:4002', config);

      const states = monitor.getAllStates();
      expect(states).toHaveLength(2);
      expect(states.find((s) => s.name === 'products')).toBeDefined();
      expect(states.find((s) => s.name === 'reviews')).toBeDefined();
    });
  });

  describe('setHealth', () => {
    it('should manually mark subgraph as healthy', () => {
      const config: SubgraphConfigItem = {
        forceMock: false,
        disableMocking: false,
        useLocalSchema: true,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      };

      monitor.registerSubgraph('products', 'http://products:4001', config);
      monitor.setHealth('products', true);

      const state = monitor.getState('products');
      expect(state?.isHealthy).toBe(true);
      expect(state?.status).toBe('available');
      expect(state?.consecutiveFailures).toBe(0);
    });

    it('should manually mark subgraph as unhealthy', () => {
      const config: SubgraphConfigItem = {
        forceMock: false,
        disableMocking: false,
        useLocalSchema: true,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      };

      monitor.registerSubgraph('products', 'http://products:4001', config);
      monitor.setHealth('products', false);

      const state = monitor.getState('products');
      expect(state?.isHealthy).toBe(false);
      expect(state?.consecutiveFailures).toBeGreaterThan(0);
    });
  });

  describe('shutdown', () => {
    it('should clear all states and stop health checks', () => {
      const config: SubgraphConfigItem = {
        forceMock: false,
        disableMocking: false,
        useLocalSchema: true,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      };

      monitor.registerSubgraph('products', 'http://products:4001', config);
      monitor.shutdown();

      const states = monitor.getAllStates();
      expect(states).toHaveLength(0);
    });
  });
});
