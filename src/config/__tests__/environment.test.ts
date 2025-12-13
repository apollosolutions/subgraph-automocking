import { describe, it, expect } from 'vitest';
import { envSchema, Environment } from '../environment';

/**
 * Environment Configuration Tests
 *
 * Tests the environment variable validation and utility functions.
 * These tests ensure that environment configuration is properly validated
 * and provides helpful error messages when misconfigured.
 *
 * Note: We test the actual envSchema exported from environment.ts
 */

/**
 * Base/stock environment configuration for testing
 * Contains all required fields with valid values
 * Tests can spread this and override specific properties
 */
const baseConfig = {
  APOLLO_KEY: 'test-api-key',
  APOLLO_GRAPH_ID: 'test-graph@production',
  APOLLO_GRAPH_VARIANT: 'current',
  SCHEMA_CACHE_TTL_MS: '300000',
  SUBGRAPH_CHECK_INTERVAL_MS: '30000',
  SUBGRAPH_HEALTH_TIMEOUT_MS: '5000',
  ENABLE_PASSTHROUGH: 'true',
  MOCK_ON_ERROR: 'true',
  LOG_LEVEL: 'info',
  LOG_PRETTY_PRINT: 'true',
  NODE_ENV: 'development',
  PORT: '3000',
};

const requiredConfig = {
  APOLLO_KEY: baseConfig.APOLLO_KEY,
  APOLLO_GRAPH_ID: baseConfig.APOLLO_GRAPH_ID,
};

describe('Environment Configuration', () => {
  describe('Required Variables', () => {
    it('should throw error when APOLLO_KEY is missing', () => {
      const { APOLLO_KEY, ...config } = baseConfig;
      expect(() => {
        envSchema.parse(config);
      }).toThrow();
    });

    it('should throw error when APOLLO_GRAPH_ID is missing', () => {
      const { APOLLO_GRAPH_ID, ...config } = baseConfig;
      expect(() => {
        envSchema.parse(config);
      }).toThrow();
    });

    it('should accept valid required environment variables', () => {
      const result = envSchema.parse(requiredConfig);

      expect(result.APOLLO_KEY).toBe('test-api-key');
      expect(result.APOLLO_GRAPH_ID).toBe('test-graph@production');
    });
  });

  describe('Default Values', () => {
    it('should use default NODE_ENV value', () => {
      const result = envSchema.parse(requiredConfig);
      expect(result.NODE_ENV).toBe('development');
    });

    it('should use default PORT value', () => {
      const result = envSchema.parse(requiredConfig);
      expect(result.PORT).toBe(3000);
    });

    it('should use default APOLLO_GRAPH_VARIANT', () => {
      const result = envSchema.parse(requiredConfig);
      expect(result.APOLLO_GRAPH_VARIANT).toBe('current');
    });

    it('should use default cache and timeout values', () => {
      const result = envSchema.parse(requiredConfig);
      expect(result.SCHEMA_CACHE_TTL_MS).toBe(300000);
      expect(result.SUBGRAPH_CHECK_INTERVAL_MS).toBe(30000);
      expect(result.SUBGRAPH_HEALTH_TIMEOUT_MS).toBe(5000);
    });

    it('should use default mocking behavior values', () => {
      const result = envSchema.parse(requiredConfig);
      expect(result.ENABLE_PASSTHROUGH).toBe(true);
      expect(result.MOCK_ON_ERROR).toBe(true);
    });

    it('should use default logging configuration', () => {
      const result = envSchema.parse(requiredConfig);
      expect(result.LOG_LEVEL).toBe('info');
      expect(result.LOG_PRETTY_PRINT).toBe(false);
    });
  });

  describe('Validation', () => {
    it('should reject invalid NODE_ENV', () => {
      expect(() => {
        envSchema.parse({
          ...baseConfig,
          NODE_ENV: 'invalid',
        });
      }).toThrow();
    });

    it('should reject non-numeric PORT', () => {
      expect(() => {
        envSchema.parse({
          ...baseConfig,
          PORT: 'not-a-number',
        });
      }).toThrow();
    });

    it('should accept numeric PORT string', () => {
      const result = envSchema.parse({
        ...baseConfig,
        PORT: '8080',
      });
      expect(result.PORT).toBe(8080);
    });

    it('should reject invalid LOG_LEVEL', () => {
      expect(() => {
        envSchema.parse({
          ...baseConfig,
          LOG_LEVEL: 'invalid',
        });
      }).toThrow();
    });

    it('should accept valid LOG_LEVEL values', () => {
      const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
      validLevels.forEach(level => {
        const result = envSchema.parse({
          ...baseConfig,
          LOG_LEVEL: level,
        });
        expect(result.LOG_LEVEL).toBe(level);
      });
    });

    it('should reject non-numeric SCHEMA_CACHE_TTL_MS', () => {
      expect(() => {
        envSchema.parse({
          ...baseConfig,
          SCHEMA_CACHE_TTL_MS: 'not-a-number',
        });
      }).toThrow();
    });

    it('should reject non-numeric SUBGRAPH_CHECK_INTERVAL_MS', () => {
      expect(() => {
        envSchema.parse({
          ...baseConfig,
          SUBGRAPH_CHECK_INTERVAL_MS: 'invalid',
        });
      }).toThrow();
    });

    it('should reject non-numeric SUBGRAPH_HEALTH_TIMEOUT_MS', () => {
      expect(() => {
        envSchema.parse({
          ...baseConfig,
          SUBGRAPH_HEALTH_TIMEOUT_MS: 'invalid',
        });
      }).toThrow();
    });

    it('should accept valid numeric timeout values', () => {
      const result = envSchema.parse({
        ...baseConfig,
        SCHEMA_CACHE_TTL_MS: '600000',
        SUBGRAPH_CHECK_INTERVAL_MS: '60000',
        SUBGRAPH_HEALTH_TIMEOUT_MS: '10000',
      });
      expect(result.SCHEMA_CACHE_TTL_MS).toBe(600000);
      expect(result.SUBGRAPH_CHECK_INTERVAL_MS).toBe(60000);
      expect(result.SUBGRAPH_HEALTH_TIMEOUT_MS).toBe(10000);
    });

    it('should validate APOLLO_KEY is not empty', () => {
      expect(() => {
        envSchema.parse({
          ...baseConfig,
          APOLLO_KEY: '',
        });
      }).toThrow();
    });

    it('should validate APOLLO_GRAPH_ID is not empty', () => {
      expect(() => {
        envSchema.parse({
          ...baseConfig,
          APOLLO_GRAPH_ID: '',
        });
      }).toThrow();
    });

    it('should accept valid boolean string values for ENABLE_PASSTHROUGH', () => {
      const resultTrue = envSchema.parse({
        ...baseConfig,
        ENABLE_PASSTHROUGH: 'true',
      });
      expect(resultTrue.ENABLE_PASSTHROUGH).toBe(true);

      const resultFalse = envSchema.parse({
        ...requiredConfig,
        ENABLE_PASSTHROUGH: 'false',
      });
      expect(resultFalse.ENABLE_PASSTHROUGH).toBe(false);
    });

    it('should accept valid boolean string values for MOCK_ON_ERROR', () => {
      const resultTrue = envSchema.parse({
        ...requiredConfig,
        MOCK_ON_ERROR: 'true',
      });
      expect(resultTrue.MOCK_ON_ERROR).toBe(true);

      const resultFalse = envSchema.parse({
        ...requiredConfig,
        MOCK_ON_ERROR: 'false',
      });
      expect(resultFalse.MOCK_ON_ERROR).toBe(false);
    });

    it('should accept valid boolean string values for LOG_PRETTY_PRINT', () => {
      const resultTrue = envSchema.parse({
        ...requiredConfig,
        LOG_PRETTY_PRINT: 'true',
      });
      expect(resultTrue.LOG_PRETTY_PRINT).toBe(true);

      const resultFalse = envSchema.parse({
        ...requiredConfig,
        LOG_PRETTY_PRINT: 'false',
      });
      expect(resultFalse.LOG_PRETTY_PRINT).toBe(false);
    });
  });

  describe('Complete Configuration', () => {
    it('should accept a complete valid configuration', () => {
      const config = {
        NODE_ENV: 'production',
        PORT: '8080',
        APOLLO_KEY: 'service:my-graph:abc123xyz',
        APOLLO_GRAPH_ID: 'my-account@my-graph',
        APOLLO_GRAPH_VARIANT: 'staging',
        SCHEMA_CACHE_TTL_MS: '600000',
        SUBGRAPH_CHECK_INTERVAL_MS: '60000',
        SUBGRAPH_HEALTH_TIMEOUT_MS: '10000',
        ENABLE_PASSTHROUGH: 'false',
        MOCK_ON_ERROR: 'false',
        LOG_LEVEL: 'debug',
        LOG_PRETTY_PRINT: 'true',
      };

      const result = envSchema.parse(config);

      expect(result.NODE_ENV).toBe('production');
      expect(result.PORT).toBe(8080);
      expect(result.APOLLO_KEY).toBe('service:my-graph:abc123xyz');
      expect(result.APOLLO_GRAPH_ID).toBe('my-account@my-graph');
      expect(result.APOLLO_GRAPH_VARIANT).toBe('staging');
      expect(result.SCHEMA_CACHE_TTL_MS).toBe(600000);
      expect(result.SUBGRAPH_CHECK_INTERVAL_MS).toBe(60000);
      expect(result.SUBGRAPH_HEALTH_TIMEOUT_MS).toBe(10000);
      expect(result.ENABLE_PASSTHROUGH).toBe(false);
      expect(result.MOCK_ON_ERROR).toBe(false);
      expect(result.LOG_LEVEL).toBe('debug');
      expect(result.LOG_PRETTY_PRINT).toBe(true);
    });

    it('should accept minimal valid configuration with defaults', () => {
      const result = envSchema.parse(requiredConfig);

      // Required fields
      expect(result.APOLLO_KEY).toBe('test-api-key');
      expect(result.APOLLO_GRAPH_ID).toBe('test-graph@production');

      // Default values
      expect(result.NODE_ENV).toBe('development');
      expect(result.PORT).toBe(3000);
      expect(result.APOLLO_GRAPH_VARIANT).toBe('current');
      expect(result.SCHEMA_CACHE_TTL_MS).toBe(300000);
      expect(result.SUBGRAPH_CHECK_INTERVAL_MS).toBe(30000);
      expect(result.SUBGRAPH_HEALTH_TIMEOUT_MS).toBe(5000);
      expect(result.ENABLE_PASSTHROUGH).toBe(true);
      expect(result.MOCK_ON_ERROR).toBe(true);
      expect(result.LOG_LEVEL).toBe('info');
      expect(result.LOG_PRETTY_PRINT).toBe(false);
    });
  });
});
