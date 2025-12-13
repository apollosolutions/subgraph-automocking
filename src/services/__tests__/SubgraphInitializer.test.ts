import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubgraphInitializer } from '../SubgraphInitializer';
import { ApolloClient } from '../ApolloClient';
import { SubgraphRegistry } from '../SubgraphRegistry';
import { SchemaCache } from '../SchemaCache';
import { loadSubgraphConfig } from '../../config/configLoader';
import { SubgraphConfigItem } from '../../config/subgraphConfig';
import { IntrospectionService } from '../IntrospectionService';

// Mock dependencies
vi.mock('../ApolloClient');
vi.mock('../SubgraphRegistry');
vi.mock('../SchemaCache');
vi.mock('../../config/configLoader');
vi.mock('../IntrospectionService');

describe('SubgraphInitializer', () => {
  let initializer: SubgraphInitializer;
  let mockApolloClient: ApolloClient;
  let mockRegistry: SubgraphRegistry;
  let mockSchemaCache: SchemaCache;
  let mockIntrospectionService: IntrospectionService;
  const mockApolloSubgraphs = [
    { name: 'products', url: 'http://products:4001/graphql' },
    { name: 'reviews', url: 'http://reviews:4002/graphql' },
    { name: 'users', url: 'http://users:4003/graphql' },
  ];

  const mockLocalConfig = {
    subgraphs: {
      products: {
        url: 'http://localhost:4001/graphql',
        forceMock: false,
        useLocalSchema: true,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
        disableMocking: false,
      } as SubgraphConfigItem,
    },
  };

  const emptyLocalConfig = {
    subgraphs: {},
  };

  beforeEach(() => {
    // Create mock instances
    mockApolloClient = new ApolloClient();
    mockIntrospectionService = new IntrospectionService();
    mockRegistry = new SubgraphRegistry();
    mockSchemaCache = new SchemaCache(mockApolloClient, mockIntrospectionService);

    // Setup default mock implementations
    vi.mocked(mockApolloClient.verifyConnection).mockResolvedValue(undefined);
    vi.mocked(mockApolloClient.listSubgraphs).mockResolvedValue(mockApolloSubgraphs);
    vi.mocked(mockSchemaCache.warmCache).mockResolvedValue(undefined);
    vi.mocked(mockSchemaCache.setSubgraphConfig).mockReturnValue(undefined);
    vi.mocked(mockRegistry.registerSubgraph).mockReturnValue(undefined);
    vi.mocked(mockRegistry.unregisterSubgraph).mockReturnValue(true);
    vi.mocked(mockRegistry.getSubgraphCount).mockReturnValue(3);
    vi.mocked(loadSubgraphConfig).mockResolvedValue(emptyLocalConfig);

    // Create initializer instance
    initializer = new SubgraphInitializer(
      mockApolloClient,
      mockRegistry,
      mockSchemaCache
    );

    vi.clearAllMocks();
  });

  describe('initialize', () => {
    it('should successfully initialize subgraphs from Apollo Platform only', async () => {
      const result = await initializer.initialize();

      // Verify Apollo connection was checked
      expect(mockApolloClient.verifyConnection).toHaveBeenCalledTimes(1);

      // Verify Apollo subgraphs were listed
      expect(mockApolloClient.listSubgraphs).toHaveBeenCalledTimes(1);

      // Verify all Apollo subgraphs were registered
      expect(mockRegistry.registerSubgraph).toHaveBeenCalledTimes(3);
      expect(mockRegistry.registerSubgraph).toHaveBeenCalledWith('products', 'http://products:4001/graphql');
      expect(mockRegistry.registerSubgraph).toHaveBeenCalledWith('reviews', 'http://reviews:4002/graphql');
      expect(mockRegistry.registerSubgraph).toHaveBeenCalledWith('users', 'http://users:4003/graphql');

      // Verify schemas were pre-fetched
      expect(mockSchemaCache.warmCache).toHaveBeenCalledTimes(1);
      expect(mockSchemaCache.warmCache).toHaveBeenCalledWith(['products', 'reviews', 'users']);

      // Verify result
      expect(result).toEqual({
        totalSubgraphs: 3,
        fromApollo: 3,
        localOverrides: 0,
      });
    });

    it('should successfully initialize with local configuration overrides', async () => {
      vi.mocked(loadSubgraphConfig).mockResolvedValue(mockLocalConfig);
      vi.mocked(mockRegistry.getSubgraphCount).mockReturnValue(3);

      const result = await initializer.initialize();

      // Verify Apollo subgraphs were registered first
      expect(mockRegistry.registerSubgraph).toHaveBeenCalledWith('products', 'http://products:4001/graphql');
      expect(mockRegistry.registerSubgraph).toHaveBeenCalledWith('reviews', 'http://reviews:4002/graphql');
      expect(mockRegistry.registerSubgraph).toHaveBeenCalledWith('users', 'http://users:4003/graphql');

      // Verify local override was applied (unregister + re-register with config)
      expect(mockRegistry.unregisterSubgraph).toHaveBeenCalledWith('products');
      expect(mockRegistry.registerSubgraph).toHaveBeenCalledWith(
        'products',
        mockLocalConfig.subgraphs.products.url,
        mockLocalConfig.subgraphs.products
      );

      // Verify result reflects local override
      expect(result).toEqual({
        totalSubgraphs: 3,
        fromApollo: 2,
        localOverrides: 1,
      });
    });

    it('should register subgraphs even with null or undefined URLs', async () => {
      const subgraphsWithNullUrl = [
        { name: 'products', url: 'http://products:4001/graphql' },
        { name: 'invalid', url: null },
        { name: 'reviews', url: 'http://reviews:4002/graphql' },
        { name: 'missing', url: undefined },
      ];

      vi.mocked(mockApolloClient.listSubgraphs).mockResolvedValue(subgraphsWithNullUrl);
      vi.mocked(mockRegistry.getSubgraphCount).mockReturnValue(4);

      await initializer.initialize();

      // Should register all subgraphs, converting null/undefined to undefined
      expect(mockRegistry.registerSubgraph).toHaveBeenCalledTimes(4);
      expect(mockRegistry.registerSubgraph).toHaveBeenCalledWith('products', 'http://products:4001/graphql');
      expect(mockRegistry.registerSubgraph).toHaveBeenCalledWith('invalid', undefined);
      expect(mockRegistry.registerSubgraph).toHaveBeenCalledWith('reviews', 'http://reviews:4002/graphql');
      expect(mockRegistry.registerSubgraph).toHaveBeenCalledWith('missing', undefined);

      // Verify schema configs were set for all subgraphs
      expect(mockSchemaCache.setSubgraphConfig).toHaveBeenCalledTimes(4);
    });

    it('should handle Apollo connection failure', async () => {
      const error = new Error('Failed to connect to Apollo Platform');
      vi.mocked(mockApolloClient.verifyConnection).mockRejectedValue(error);

      await expect(initializer.initialize()).rejects.toThrow('Failed to connect to Apollo Platform');

      // Should not proceed with initialization
      expect(mockApolloClient.listSubgraphs).not.toHaveBeenCalled();
      expect(mockRegistry.registerSubgraph).not.toHaveBeenCalled();
    });

    it('should handle Apollo listSubgraphs failure', async () => {
      const error = new Error('Failed to list subgraphs');
      vi.mocked(mockApolloClient.listSubgraphs).mockRejectedValue(error);

      await expect(initializer.initialize()).rejects.toThrow('Failed to list subgraphs');

      // Should verify connection but fail at listing
      expect(mockApolloClient.verifyConnection).toHaveBeenCalled();
      expect(mockRegistry.registerSubgraph).not.toHaveBeenCalled();
    });

    it('should handle empty Apollo subgraph list', async () => {
      vi.mocked(mockApolloClient.listSubgraphs).mockResolvedValue([]);
      vi.mocked(mockRegistry.getSubgraphCount).mockReturnValue(0);

      const result = await initializer.initialize();

      // Should complete successfully but register nothing
      expect(mockRegistry.registerSubgraph).not.toHaveBeenCalled();
      expect(mockSchemaCache.warmCache).toHaveBeenCalledWith([]);
      expect(result).toEqual({
        totalSubgraphs: 0,
        fromApollo: 0,
        localOverrides: 0,
      });
    });

    it('should handle schema cache warming failure gracefully', async () => {
      const error = new Error('Failed to warm cache');
      vi.mocked(mockSchemaCache.warmCache).mockRejectedValue(error);

      // Should throw error since warmCache failure is critical
      await expect(initializer.initialize()).rejects.toThrow('Failed to warm cache');
    });

    it('should handle multiple local overrides correctly', async () => {
      const multipleOverridesConfig = {
        subgraphs: {
          products: {
            url: 'http://localhost:4001/graphql',
            forceMock: false,
            useLocalSchema: true,
            maxRetries: 3,
            retryDelayMs: 1000,
            healthCheckIntervalMs: 30000,
            disableMocking: false,
          } as SubgraphConfigItem,
          reviews: {
            url: 'http://localhost:4002/graphql',
            forceMock: true,
            useLocalSchema: true,
            maxRetries: 3,
            retryDelayMs: 1000,
            healthCheckIntervalMs: 30000,
            disableMocking: false,
          } as SubgraphConfigItem,
        },
      };

      vi.mocked(loadSubgraphConfig).mockResolvedValue(multipleOverridesConfig);
      vi.mocked(mockRegistry.getSubgraphCount).mockReturnValue(3);

      const result = await initializer.initialize();

      // Should apply both overrides
      expect(mockRegistry.unregisterSubgraph).toHaveBeenCalledWith('products');
      expect(mockRegistry.unregisterSubgraph).toHaveBeenCalledWith('reviews');

      expect(mockRegistry.registerSubgraph).toHaveBeenCalledWith(
        'products',
        expect.any(String),
        multipleOverridesConfig.subgraphs.products
      );
      expect(mockRegistry.registerSubgraph).toHaveBeenCalledWith(
        'reviews',
        expect.any(String),
        multipleOverridesConfig.subgraphs.reviews
      );

      // Should reflect multiple overrides
      expect(result).toEqual({
        totalSubgraphs: 3,
        fromApollo: 1, // Only 'users' is Apollo-only
        localOverrides: 2, // 'products' and 'reviews' have local config
      });
    });

    it('should preserve replace apollo URL with local URL when applying local config', async () => {
      vi.mocked(loadSubgraphConfig).mockResolvedValue(mockLocalConfig);
      vi.mocked(mockRegistry.getSubgraphCount).mockReturnValue(3);

      await initializer.initialize();

      // Verify that the Apollo URL is used (not changed by local config)
      // The second registration with config should use the same URL
      const lastCallWithConfig = vi.mocked(mockRegistry.registerSubgraph).mock.calls.find(
        call => call[2] !== undefined // Find call with config parameter
      );

      expect(lastCallWithConfig).toBeDefined();
      expect(lastCallWithConfig![0]).toBe('products');
      expect(lastCallWithConfig![1]).toBe(mockLocalConfig.subgraphs.products.url);
      expect(lastCallWithConfig![2]).toBe(mockLocalConfig.subgraphs.products);
    });

    it('should use undefined if Apollo subgraph has no URL', async () => {
      const subgraphsWithoutUrl = [
        { name: 'products', url: null },
      ];

      const localConfigForProducts = {
        subgraphs: {
          products: {
            forceMock: false,
            url: 'http://localhost:4001/graphql',
            useLocalSchema: true,
            maxRetries: 3,
            retryDelayMs: 1000,
            healthCheckIntervalMs: 30000,
            disableMocking: false,
          } as SubgraphConfigItem,
        },
      };

      vi.mocked(mockApolloClient.listSubgraphs).mockResolvedValue(subgraphsWithoutUrl);
      vi.mocked(loadSubgraphConfig).mockResolvedValue(localConfigForProducts);
      vi.mocked(mockRegistry.getSubgraphCount).mockReturnValue(1); // One subgraph registered

      await initializer.initialize();

      // Should first register with undefined URL
      expect(mockRegistry.registerSubgraph).toHaveBeenCalledWith('products', undefined);

      // Then unregister and re-register with local endpoint
      expect(mockRegistry.unregisterSubgraph).toHaveBeenCalledWith('products');

      const callsWithConfig = vi.mocked(mockRegistry.registerSubgraph).mock.calls.filter(
        call => call[2] !== undefined
      );

      expect(callsWithConfig.length).toBeGreaterThan(0);
      expect(callsWithConfig[0][1]).toBe(localConfigForProducts.subgraphs.products.url);
    });
  });

  describe('initialization phases', () => {
    it('should execute phases in correct order', async () => {
      const executionOrder: string[] = [];

      vi.mocked(mockApolloClient.verifyConnection).mockImplementation(async () => {
        executionOrder.push('verifyConnection');
        return true;
      });

      vi.mocked(mockApolloClient.listSubgraphs).mockImplementation(async () => {
        executionOrder.push('listSubgraphs');
        return mockApolloSubgraphs;
      });

      vi.mocked(loadSubgraphConfig).mockImplementation(async () => {
        executionOrder.push('loadLocalConfig');
        return emptyLocalConfig;
      });

      vi.mocked(mockRegistry.registerSubgraph).mockImplementation(() => {
        executionOrder.push('registerSubgraph');
      });

      vi.mocked(mockSchemaCache.warmCache).mockImplementation(async () => {
        executionOrder.push('warmCache');
      });

      await initializer.initialize();

      // Verify execution order
      expect(executionOrder[0]).toBe('verifyConnection');
      expect(executionOrder[1]).toBe('listSubgraphs');
      expect(executionOrder[2]).toBe('loadLocalConfig');

      // Registration happens multiple times for each subgraph
      const registerIndex = executionOrder.indexOf('registerSubgraph');
      expect(registerIndex).toBeGreaterThan(2);

      // warmCache happens after all registrations
      const warmCacheIndex = executionOrder.indexOf('warmCache');
      expect(warmCacheIndex).toBeGreaterThan(registerIndex);
    });
  });

  describe('error handling', () => {
    it('should provide descriptive error when local config loading fails', async () => {
      const error = new Error('Permission denied reading config file');
      vi.mocked(loadSubgraphConfig).mockRejectedValue(error);

      await expect(initializer.initialize()).rejects.toThrow('Permission denied reading config file');
    });

  });
});
