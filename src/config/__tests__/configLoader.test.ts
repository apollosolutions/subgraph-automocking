import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { loadSubgraphConfig } from '../configLoader';
import path from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

describe('configLoader', () => {
  let tempConfigDir: string;
  let tempConfigPath: string;

  beforeEach(async () => {
    // Create a unique temporary directory for each test
    tempConfigDir = path.join(tmpdir(), `test-config-${randomBytes(8).toString('hex')}`);
    await fs.mkdir(tempConfigDir, { recursive: true });
    tempConfigPath = path.join(tempConfigDir, 'subgraphs.js');
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tempConfigDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('loadSubgraphConfig', () => {
    it('should load and validate valid configuration from JS file', async () => {
      const configContent = `
export const config = {
  subgraphs: {
    products: {
      useLocalSchema: true,
      maxRetries: 3,
    },
  },
};
`;
      await fs.writeFile(tempConfigPath, configContent);

      const result = await loadSubgraphConfig(tempConfigPath);

      expect(result.subgraphs.products).toBeDefined();
      expect(result.subgraphs.products.useLocalSchema).toBe(true);
      expect(result.subgraphs.products.maxRetries).toBe(3);
    });

    it('should support default export', async () => {
      const configContent = `
export default {
  subgraphs: {
    reviews: {
      forceMock: true,
    },
  },
};
`;
      await fs.writeFile(tempConfigPath, configContent);

      const result = await loadSubgraphConfig(tempConfigPath);

      expect(result.subgraphs.reviews).toBeDefined();
      expect(result.subgraphs.reviews.forceMock).toBe(true);
    });

    it('should support environment variables in JS config', async () => {
      process.env.TEST_PRODUCTS_URL = 'http://test-products.example.com';

      const configContent = `
export const config = {
  subgraphs: {
    products: {
      url: process.env.TEST_PRODUCTS_URL,
    },
  },
};
`;
      await fs.writeFile(tempConfigPath, configContent);

      const result = await loadSubgraphConfig(tempConfigPath);

      expect(result.subgraphs.products.url).toBe('http://test-products.example.com');

      delete process.env.TEST_PRODUCTS_URL;
    });

    it('should support computed values and object spread', async () => {
      const configContent = `
const defaultConfig = {
  forceMock: false,
  disableMocking: false,
  useLocalSchema: false,
};

export const config = {
  subgraphs: {
    products: {
      ...defaultConfig,
      forceMock: true, // Override
    },
    reviews: {
      ...defaultConfig,
    },
  },
};
`;
      await fs.writeFile(tempConfigPath, configContent);

      const result = await loadSubgraphConfig(tempConfigPath);

      expect(result.subgraphs.products.forceMock).toBe(true);
      expect(result.subgraphs.products.disableMocking).toBe(false);
      expect(result.subgraphs.reviews.forceMock).toBe(false);
    });

    it('should return empty config when file not found', async () => {
      const nonExistentPath = path.join(tempConfigDir, 'does-not-exist.js');

      const result = await loadSubgraphConfig(nonExistentPath);

      expect(result.subgraphs).toEqual({});
    });

    it('should throw error when config export is missing', async () => {
      const configContent = `
// No export
const config = {
  subgraphs: {},
};
`;
      await fs.writeFile(tempConfigPath, configContent);

      await expect(loadSubgraphConfig(tempConfigPath)).rejects.toThrow(
        'Configuration file must export a "config" object or default export'
      );
    });

    it('should throw error for invalid configuration schema', async () => {
      const configContent = `
export const config = {
  subgraphs: {
    products: {
      forceMock: true,
      disableMocking: true, // Conflict!
    },
  },
};
`;
      await fs.writeFile(tempConfigPath, configContent);

      await expect(loadSubgraphConfig(tempConfigPath)).rejects.toThrow('validation failed');
    });

    it('should apply default values to minimal config', async () => {
      const configContent = `
export const config = {
  subgraphs: {
    products: {},
  },
};
`;
      await fs.writeFile(tempConfigPath, configContent);

      const result = await loadSubgraphConfig(tempConfigPath);

      expect(result.subgraphs.products.maxRetries).toBe(3);
      expect(result.subgraphs.products.retryDelayMs).toBe(1000);
      expect(result.subgraphs.products.healthCheckIntervalMs).toBe(30000);
    });

    it('should load multiple subgraphs', async () => {
      const configContent = `
export const config = {
  subgraphs: {
    products: {
      useLocalSchema: true,
    },
    reviews: {
      forceMock: true,
    },
  },
};
`;
      await fs.writeFile(tempConfigPath, configContent);

      const result = await loadSubgraphConfig(tempConfigPath);

      expect(Object.keys(result.subgraphs)).toHaveLength(2);
      expect(result.subgraphs.products).toBeDefined();
      expect(result.subgraphs.reviews).toBeDefined();
      expect(result.subgraphs.reviews.forceMock).toBe(true);
    });

    it('should handle syntax errors in JS file gracefully', async () => {
      const configContent = `
export const config = {
  subgraphs: {
    products: {
      forceMock: // Syntax error - missing value
    },
  },
};
`;
      await fs.writeFile(tempConfigPath, configContent);

      await expect(loadSubgraphConfig(tempConfigPath)).rejects.toThrow();
    });

    it('should support dynamic configuration based on conditions', async () => {
      const configContent = `
const isDevelopment = process.env.NODE_ENV === 'development';

export const config = {
  subgraphs: {
    products: {
      forceMock: isDevelopment,
      url: isDevelopment ? undefined : 'http://prod.example.com',
    },
  },
};
`;
      await fs.writeFile(tempConfigPath, configContent);

      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const result = await loadSubgraphConfig(tempConfigPath);

      expect(result.subgraphs.products.forceMock).toBe(true);
      expect(result.subgraphs.products.url).toBeUndefined();

      process.env.NODE_ENV = originalNodeEnv;
    });
  });
});
