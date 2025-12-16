import { describe, it, expect } from 'vitest';
import {
  validateSubgraphConfig,
  determineRoutingBehavior,
  SubgraphConfigItem,
  DEFAULT_SUBGRAPH_CONFIG,
} from '../subgraphConfig';

describe('subgraphConfig', () => {
  describe('validateSubgraphConfig', () => {
    it('should validate valid configuration', () => {
      const validConfig = {
        subgraphs: {
          products: {
            useLocalSchema: true,
            maxRetries: 3,
            retryDelayMs: 1000,
            url: 'http://localhost:4001',
          },
        },
      };

      const result = validateSubgraphConfig(validConfig);

      expect(result.subgraphs.products).toBeDefined();
      expect(result.subgraphs.products.useLocalSchema).toBe(true);
      expect(result.subgraphs.products.maxRetries).toBe(3);
    });

    it('should apply default values', () => {
      const minimalConfig = {
        subgraphs: {
          products: {},
        },
      };

      const result = validateSubgraphConfig(minimalConfig);

      expect(result.subgraphs.products.forceMock).toBe(false);
      expect(result.subgraphs.products.disableMocking).toBe(false);
      expect(result.subgraphs.products.maxRetries).toBe(3);
      expect(result.subgraphs.products.retryDelayMs).toBe(1000);
      expect(result.subgraphs.products.healthCheckIntervalMs).toBe(30000);
    });

    it('should reject forceMock and disableMocking both true', () => {
      const invalidConfig = {
        subgraphs: {
          products: {
            forceMock: true,
            disableMocking: true,
          },
        },
      };

      expect(() => validateSubgraphConfig(invalidConfig)).toThrow();
    });

    it('should reject useLocalSchema without a url or schemaFile', () => {
      const invalidConfig = {
        subgraphs: {
          products: {
            useLocalSchema: true,
          },
        },
      };

      expect(() => validateSubgraphConfig(invalidConfig)).toThrow();
    });

    it('should accept useLocalSchema with a url', () => {
      const validConfig = {
        subgraphs: {
          products: {
            useLocalSchema: true,
            url: 'http://localhost:4001',
          },
        },
      };

      expect(() => validateSubgraphConfig(validConfig)).not.toThrow();
    });

    it('should accept useLocalSchema with a schemaFile', () => {
      const validConfig = {
        subgraphs: {
          products: {
            useLocalSchema: true,
            schemaFile: 'products.graphql',
          },
        },
      };

      expect(() => validateSubgraphConfig(validConfig)).not.toThrow();
    });

    it('should reject maxRetries out of range', () => {
      const invalidConfig = {
        subgraphs: {
          products: {
            maxRetries: 15,
          },
        },
      };

      expect(() => validateSubgraphConfig(invalidConfig)).toThrow();
    });

    it('should reject retryDelayMs out of range', () => {
      const invalidConfig = {
        subgraphs: {
          products: {
            retryDelayMs: 50,
          },
        },
      };

      expect(() => validateSubgraphConfig(invalidConfig)).toThrow();
    });

    it('should reject healthCheckIntervalMs out of range', () => {
      const invalidConfig = {
        subgraphs: {
          products: {
            healthCheckIntervalMs: 1000,
          },
        },
      };

      expect(() => validateSubgraphConfig(invalidConfig)).toThrow();
    });

    it('should handle multiple subgraphs', () => {
      const config = {
        subgraphs: {
          products: {
          },
          reviews: {
            forceMock: true,
          },
          users: {
            disableMocking: true,
          },
        },
      };

      const result = validateSubgraphConfig(config);

      expect(Object.keys(result.subgraphs)).toHaveLength(3);
      expect(result.subgraphs.products.forceMock).toBe(false);
      expect(result.subgraphs.reviews.forceMock).toBe(true);
      expect(result.subgraphs.users.disableMocking).toBe(true);
    });
  });

  describe('determineRoutingBehavior', () => {
    it('should always mock when forceMock is true', () => {
      const config: SubgraphConfigItem = {
        forceMock: true,
        disableMocking: false,
        useLocalSchema: true,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      };

      const result = determineRoutingBehavior(config, true, 0);

      expect(result.shouldMock).toBe(true);
      expect(result.shouldPassthrough).toBe(false);
      expect(result.schemaSource).toBe('local-introspection');
    });

    it('should use apollo registry when forceMock and useLocalSchema is false', () => {
      const config: SubgraphConfigItem = {
        forceMock: true,
        disableMocking: false,
        useLocalSchema: false,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      };

      const result = determineRoutingBehavior(config, false, 5);

      expect(result.shouldMock).toBe(true);
      expect(result.schemaSource).toBe('apollo-registry');
    });

    it('should never mock when disableMocking is true', () => {
      const config: SubgraphConfigItem = {
        forceMock: false,
        disableMocking: true,
        useLocalSchema: false,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      };

      const result = determineRoutingBehavior(config, false, 10);

      expect(result.shouldMock).toBe(false);
      expect(result.shouldPassthrough).toBe(true);
    });

    it('should passthrough when healthy', () => {
      const config: SubgraphConfigItem = {
        forceMock: false,
        disableMocking: false,
        useLocalSchema: true,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      };

      const result = determineRoutingBehavior(config, true, 0);

      expect(result.shouldMock).toBe(false);
      expect(result.shouldPassthrough).toBe(true);
      expect(result.schemaSource).toBe('local-introspection');
    });

    it('should mock after retries exhausted', () => {
      const config: SubgraphConfigItem = {
        forceMock: false,
        disableMocking: false,
        useLocalSchema: true,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      };

      const result = determineRoutingBehavior(config, false, 3);

      expect(result.shouldMock).toBe(true);
      expect(result.shouldPassthrough).toBe(false);
    });

    it('should continue passthrough while retrying', () => {
      const config: SubgraphConfigItem = {
        forceMock: false,
        disableMocking: false,
        useLocalSchema: true,
        maxRetries: 3,
        retryDelayMs: 1000,
        healthCheckIntervalMs: 30000,
      };

      const result = determineRoutingBehavior(config, false, 2);

      expect(result.shouldMock).toBe(false);
      expect(result.shouldPassthrough).toBe(true);
    });
  });

  describe('DEFAULT_SUBGRAPH_CONFIG', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_SUBGRAPH_CONFIG.forceMock).toBe(false);
      expect(DEFAULT_SUBGRAPH_CONFIG.disableMocking).toBe(false);
      expect(DEFAULT_SUBGRAPH_CONFIG.useLocalSchema).toBe(false);
      expect(DEFAULT_SUBGRAPH_CONFIG.maxRetries).toBe(2);
      expect(DEFAULT_SUBGRAPH_CONFIG.retryDelayMs).toBe(1000);
      expect(DEFAULT_SUBGRAPH_CONFIG.healthCheckIntervalMs).toBe(30000);
    });
  });
});
