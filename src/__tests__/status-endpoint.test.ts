import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { MockingProxyServer } from '../server';
import { SubgraphRegistry } from '../services/SubgraphRegistry';
import { SubgraphHealthMonitor } from '../services/SubgraphHealthMonitor';
import { IntrospectionService } from '../services/IntrospectionService';

describe('GET /status endpoint', () => {
  let server: MockingProxyServer;
  let registry: SubgraphRegistry;
  let healthMonitor: SubgraphHealthMonitor;

  beforeEach(() => {
    healthMonitor = new SubgraphHealthMonitor(new IntrospectionService());
    registry = new SubgraphRegistry(30000, 5000, healthMonitor);

    server = new MockingProxyServer({
      subgraphRegistry: registry,
    });
  });

  afterEach(() => {
    registry.stopHealthChecks();
    healthMonitor.shutdown();
  });

  describe('basic functionality', () => {
    it('should return empty list when no subgraphs registered', async () => {
      const response = await request(server.getApp()).get('/status');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('totalSubgraphs', 0);
      expect(response.body).toHaveProperty('healthySubgraphs', 0);
      expect(response.body).toHaveProperty('mockingSubgraphs', 0);
      expect(response.body.subgraphs).toEqual([]);
    });

    it('should return registered subgraphs', async () => {
      registry.registerSubgraph('products', 'http://products:4001/graphql');
      registry.registerSubgraph('reviews', 'http://reviews:4002/graphql');

      const response = await request(server.getApp()).get('/status');

      expect(response.status).toBe(200);
      expect(response.body.totalSubgraphs).toBe(2);
      expect(response.body.subgraphs).toHaveLength(2);

      const productsSubgraph = response.body.subgraphs.find((s: any) => s.name === 'products');
      expect(productsSubgraph).toBeDefined();
      expect(productsSubgraph.url).toBe('http://products:4001/graphql');
      expect(productsSubgraph).toHaveProperty('isHealthy');
      expect(productsSubgraph).toHaveProperty('isMocking');
      expect(productsSubgraph).toHaveProperty('schemaSource');
      expect(productsSubgraph).toHaveProperty('lastCheck');
    });
  });

  describe('subgraph with configuration', () => {
    it('should show enhanced info for configured subgraphs', async () => {
      registry.registerSubgraph('products', 'http://products:4001/graphql', {
        forceMock: false,
        disableMocking: false,
        useLocalSchema: true,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      });

      const response = await request(server.getApp()).get('/status');

      expect(response.status).toBe(200);
      expect(response.body.totalSubgraphs).toBe(1);

      const productsSubgraph = response.body.subgraphs[0];
      expect(productsSubgraph.name).toBe('products');
      expect(productsSubgraph.url).toBe('http://products:4001/graphql');
      expect(productsSubgraph.schemaSource).toBe('local-introspection');
      expect(productsSubgraph.config).toBeDefined();
      expect(productsSubgraph.config.forceMock).toBe(false);
      expect(productsSubgraph.config.maxRetries).toBe(3);
    });

    it('should show mocking status for forceMock configuration', async () => {
      registry.registerSubgraph('products', 'http://products:4001/graphql', {
        forceMock: true,
        disableMocking: false,
        useLocalSchema: true,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      });

      const response = await request(server.getApp()).get('/status');

      const productsSubgraph = response.body.subgraphs[0];
      expect(productsSubgraph.isMocking).toBe(true);
      // Status will be 'unknown' initially until a health check is performed
      // After health check, forceMock subgraphs will show 'mocking' status
      expect(['unknown', 'mocking']).toContain(productsSubgraph.status);
    });

    it('should show apollo-registry when useLocalSchema is false', async () => {
      registry.registerSubgraph('products', 'http://products:4001/graphql', {
        forceMock: false,
        disableMocking: false,
        useLocalSchema: false,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      });

      const response = await request(server.getApp()).get('/status');

      const productsSubgraph = response.body.subgraphs[0];
      expect(productsSubgraph.schemaSource).toBe('apollo-registry');
    });
  });

  describe('health and availability tracking', () => {
    it('should track healthy subgraphs count', async () => {
      // Register some subgraphs
      registry.registerSubgraph('products', 'http://products:4001/graphql');
      registry.registerSubgraph('reviews', 'http://reviews:4002/graphql');

      // Manually set one as available
      const productsInfo = registry.getSubgraphByName('products');
      if (productsInfo) {
        registry['registry'].set('products', {
          ...productsInfo,
          isAvailable: true,
          consecutiveFailures: 0,
        });
      }

      const response = await request(server.getApp()).get('/status');

      expect(response.body.totalSubgraphs).toBe(2);
      expect(response.body.healthySubgraphs).toBe(1);
    });

    it('should track mocking subgraphs count', async () => {
      registry.registerSubgraph('products', 'http://products:4001/graphql', {
        forceMock: true,
        disableMocking: false,
        useLocalSchema: true,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      });

      registry.registerSubgraph('reviews', 'http://reviews:4002/graphql');

      const response = await request(server.getApp()).get('/status');

      expect(response.body.totalSubgraphs).toBe(2);
      expect(response.body.mockingSubgraphs).toBe(1);
    });

    it('should include consecutive failures count', async () => {
      registry.registerSubgraph('products', 'http://products:4001/graphql');

      // Manually set failures
      const productsInfo = registry.getSubgraphByName('products');
      if (productsInfo) {
        registry['registry'].set('products', {
          ...productsInfo,
          isAvailable: false,
          consecutiveFailures: 5,
        });
      }

      const response = await request(server.getApp()).get('/status');

      const productsSubgraph = response.body.subgraphs[0];
      expect(productsSubgraph.consecutiveFailures).toBe(5);
      expect(productsSubgraph.isHealthy).toBe(false);
    });
  });

  describe('response format', () => {
    it('should include all required fields in response', async () => {
      registry.registerSubgraph('products', 'http://products:4001/graphql');

      const response = await request(server.getApp()).get('/status');

      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('totalSubgraphs');
      expect(response.body).toHaveProperty('healthySubgraphs');
      expect(response.body).toHaveProperty('mockingSubgraphs');
      expect(response.body).toHaveProperty('subgraphs');
      expect(Array.isArray(response.body.subgraphs)).toBe(true);
    });

    it('should include all required subgraph fields', async () => {
      registry.registerSubgraph('products', 'http://products:4001/graphql');

      const response = await request(server.getApp()).get('/status');

      const subgraph = response.body.subgraphs[0];
      expect(subgraph).toHaveProperty('name');
      expect(subgraph).toHaveProperty('url');
      expect(subgraph).toHaveProperty('status');
      expect(subgraph).toHaveProperty('isHealthy');
      expect(subgraph).toHaveProperty('isMocking');
      expect(subgraph).toHaveProperty('schemaSource');
      expect(subgraph).toHaveProperty('lastCheck');
      expect(subgraph).toHaveProperty('consecutiveFailures');
    });

    it('should have valid timestamp format', async () => {
      const response = await request(server.getApp()).get('/status');

      expect(response.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
    });
  });
});
