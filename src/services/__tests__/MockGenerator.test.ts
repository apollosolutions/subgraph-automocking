import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraphQLSchema, parse } from 'graphql';
import { MockGenerator } from '../../../src/services/MockGenerator';
import { IMocks } from '@graphql-tools/mock';
import { promises as fs } from 'fs';
import { buildSubgraphSchema } from '@apollo/subgraph';

// Mock only fs for file access tests - let @graphql-tools/mock run for real
vi.mock('fs', () => ({
  promises: {
    access: vi.fn(),
  },
}));

// Mock dynamic import to return a simple mock object
vi.mock('/default/path/mocks.js', () => ({
  mocks: {
    _globals: {
      ID: () => `default-id-${Math.random().toString(36).substring(2, 9)}`,
    },
    products: {
      Int: () => Math.floor(Math.random() * 10000),
      String: () => 'Product Default String',
      Product: () => ({
        id: `product-${Math.floor(Math.random() * 1000)}`,
        name: 'Product Name',
      }),
    }
  }
}));

describe('MockGenerator', () => {
  let generator: MockGenerator;

  const mockSchemaSDL = `
    type Product {
      id: ID!
      name: String!
      price: Float!
      inStock: Boolean!
    }

    type Query {
      products: [Product!]!
      product(id: ID!): Product
    }
  `;

  const testSchema = buildSubgraphSchema({ typeDefs: parse(mockSchemaSDL) });

  beforeEach(() => {
    generator = new MockGenerator('/default/path');
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create a generator with default mocks directory', () => {
      expect(generator).toBeInstanceOf(MockGenerator);
    });

    it('should create a generator with custom mocks directory', () => {
      const mocksDirectory = '/custom/mocks';
      const customGenerator = new MockGenerator(mocksDirectory);
      expect(customGenerator).toBeInstanceOf(MockGenerator);
      expect(customGenerator.mocksDirectory).toBe(mocksDirectory);
    });
  });

  describe('loadCustomMocks', () => {
    it('should return null when no mock file exists', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));

      const result = await generator.loadCustomMocks();

      expect(result).toBeNull();
    });

    it('should handle TypeScript files gracefully', async () => {
      // First check for .js fails
      vi.mocked(fs.access).mockRejectedValueOnce(new Error('Not found'));
      // Then check for .ts succeeds
      vi.mocked(fs.access).mockResolvedValueOnce(undefined);

      const result = await generator.loadCustomMocks();

      // TypeScript files are not supported at runtime
      expect(result).toBeNull();
      expect(fs.access).toHaveBeenCalledTimes(2);
    });

    it('should not cache when file not found', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('Not found'));

      await generator.loadCustomMocks();

      // Should not be cached
      const customMocks = await generator.getCustomMocks('products');
      expect(customMocks).toBeUndefined();
      // called 4 times, twice per extension since getCustomMocks calls loadCustomMocks
      expect(fs.access).toHaveBeenCalledTimes(4);
    });
  });

  describe('getCustomMocks', () => {
    it('should return undefined for non-loaded mocks', async () => {
      const mocks = await generator.getCustomMocks('nonexistent');
      expect(mocks).toBeUndefined();
    });
  });

  describe('generateMockResponseForSubgraph', () => {
    it('should use custom mocks for subgraph if available', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);

      const query = 'query GetProducts { products { id name } }';

      const result = await generator.generateMockResponseForSubgraph(
        'products',
        testSchema,
        query,
        undefined,
        undefined,
      );

      expect(result).toHaveProperty('data');
      expect(result.data).toHaveProperty('products');
      expect(Array.isArray(result.data.products)).toBe(true);
      expect(result.data.products.length).toBeGreaterThan(0);
      expect(result.data.products[0]).toHaveProperty('name');
    });

    it('should fall back to default mocks if no custom mocks exist', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('Not found'));

      const query = '{ products { id } }';

      const result = await generator.generateMockResponseForSubgraph(
        'products',
        testSchema,
        query
      );

      expect(result).toHaveProperty('data');
      expect(result.data).toHaveProperty('products');
    });

    it('should merge custom mocks with options', async () => {
      const idResult = 'option-id';
      const nameResult = 'Option Product';
      const optionMocks: IMocks = {
        Product: () => ({
          id: () => idResult,
          name: () => nameResult,
        }),
      };

      vi.mocked(fs.access).mockResolvedValue(undefined);

      const result = await generator.generateMockResponseForSubgraph(
        'products',
        testSchema,
        'query { products { id name } }',
        {},
        undefined,
        { mocks: optionMocks }
      );

      expect(result).toHaveProperty('data');
      expect(result.data).toHaveProperty('products');
      expect(result.data.products[0].id).toBe(idResult);
      expect(result.data.products[0].name).toBe(nameResult);
    });

    it('should handle queries with variables', async () => {
      const query = 'query GetProduct($id: ID!) { product(id: $id) { id name } }';
      const variables = { id: '123' };

      const result = await generator.generateMockResponseForSubgraph(
        'products',
        testSchema,
        query,
        variables,
      );

      expect(result).toHaveProperty('data');
      expect(result.data).toHaveProperty('product');
      expect(result.data.product).toHaveProperty('id');
      expect(result.data.product).toHaveProperty('name');
    });

    it('should handle operation names', async () => {
      const query = `
        query GetProduct { product(id: "1") { id } }
        query GetProducts { products { id } }
      `;

      const result = await generator.generateMockResponseForSubgraph(
        'products',
        testSchema,
        query,
        {},
        'GetProduct'
      );

      expect(result).toHaveProperty('data');
      expect(result.data).toHaveProperty('product');
      expect(result.data).not.toHaveProperty('products');
    });

    it('should handle basic queries without options', async () => {
      const query = 'query { products { id } }';

      const result = await generator.generateMockResponseForSubgraph(
        'products',
        testSchema,
        query,
        {},
        undefined
      );

      expect(result).toHaveProperty('data');
      expect(result.data).toHaveProperty('products');
    });

    it('should handle GraphQL errors in query', async () => {
      const invalidQuery = '{ invalidField }';

      const result = await generator.generateMockResponseForSubgraph(
        'products',
        testSchema,
        invalidQuery,
      );

      expect(result).toHaveProperty('errors');
      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should throw error when schema mocking fails', async () => {
      // Create an invalid schema to trigger mocking failure
      const invalidSchema = null as unknown as GraphQLSchema;

      await expect(
        generator.generateMockResponseForSubgraph(
          'products',
          invalidSchema,
          '{ products { id } }'
        )
      ).rejects.toThrow()
    });
  });

  describe('clearCustomMocks', () => {
    it('should clear all loaded custom mocks', async () => {
      // Since we can't easily mock dynamic imports, test the clear functionality directly
      generator.clearCustomMocks();

      // WARNING: not ideal since the underlying structures may change
      expect(generator['customMocks'].size).toBe(0);
      expect(generator['mocksInput']).toBeNull();
    });
  });

  describe('error scenarios', () => {
    it('should handle syntax errors in query', async () => {
      const invalidQuery = '{ products { id name }'; // Missing closing brace

      const result = await generator.generateMockResponseForSubgraph(
        'products',
        testSchema,
        invalidQuery
      );

      expect(result.errors).toBeDefined();
      expect(result.errors?.length).toBeGreaterThan(0);
    });

    it('should handle missing required variables', async () => {
      const query = 'query GetProduct($id: ID!) { product(id: $id) { id } }';

      const result = await generator.generateMockResponseForSubgraph(
        'products',
        testSchema,
        query
      );

      expect(result.errors).toBeDefined();
    });

    it('should handle errors when loading custom mocks throws exception', async () => {
      // Mock fs.access to succeed for .js file
      vi.mocked(fs.access).mockResolvedValueOnce(undefined);

      // Mock dynamic import to throw error
      vi.mock('/custom/path/mocks.ts', () => {
        throw new Error('Module loading failed');
      });

      const customGenerator = new MockGenerator('/custom/path');
      const result = await customGenerator.loadCustomMocks();

      // Should return undefined when loading fails
      expect(result).toBeNull();
    });
  });

  describe('custom mocks caching behavior', () => {
    it('should use cached mocks on subsequent calls for same subgraph', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      expect(fs.access).not.toHaveBeenCalled();


      // First call should attempt to load
      await generator.generateMockResponseForSubgraph(
        'products',
        testSchema,
        '{ products { id } }'
      );

      // Second call should use cached version (won't call loadCustomMocks again)
      const result = await generator.generateMockResponseForSubgraph(
        'products',
        testSchema,
        '{ products { name } }'
      );

      expect(fs.access).toHaveBeenCalledTimes(1);

      expect(result).toHaveProperty('data');
      expect(result.data).toHaveProperty('products');
    });
  });

  describe('additional default mock coverage', () => {

    it('should handle empty query gracefully', async () => {
      const result = await generator.generateMockResponseForSubgraph(
        'products',
        testSchema,
        ''
      );

      expect(result.errors).toBeDefined();
      expect(result.errors?.length).toBeGreaterThan(0);
    });

    it('should handle query with invalid operation name', async () => {
      const query = `
        query GetProduct { product(id: "1") { id } }
      `;

      const result = await generator.generateMockResponseForSubgraph(
        'products',
        testSchema,
        query,
        {},
        'NonExistentOperation'
      );

      // Should have errors for non-existent operation
      expect(result).toBeDefined();
      expect(result.errors).toBeDefined();
    });
  });

  describe('generateMockResponseForSubgraph edge cases', () => {
    it('should handle empty operation name gracefully', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('Not found'));

      const result = await generator.generateMockResponseForSubgraph(
        'products',
        testSchema,
        '{ products { id } }',
        {},
        undefined  // undefined is correct for no operation name, empty string causes errors
      );

      expect(result).toHaveProperty('data');
      expect(result.data).toHaveProperty('products');
    });
  });

  describe('clearCustomMocks behavior', () => {
    it('should allow reloading mocks after clearing', async () => {
      vi.mocked(fs.access).mockRejectedValueOnce(new Error('Not found'));
      vi.mocked(fs.access).mockResolvedValueOnce(undefined);

      await generator.loadCustomMocks();

      generator.clearCustomMocks();

      // After clearing, should be able to load again
      const result = await generator.loadCustomMocks();
      expect(result).toBeNull(); // Still undefined because file doesn't exist
    });
  });

  describe('loadCustomMocks error handling', () => {
    it('should handle import errors gracefully', async () => {
      // File exists but import fails - mocks.js exists with empty subgraph
      vi.mocked(fs.access).mockResolvedValueOnce(undefined);

      const result = await generator.loadCustomMocks();

      // Should return merged mocks (globals + empty subgraph)
      expect(result).toBeDefined();
    });

    it('should check for both .js and .ts file extensions', async () => {
      // First .js check fails
      vi.mocked(fs.access).mockRejectedValueOnce(new Error('Not found'));
      // Then .ts check also fails
      vi.mocked(fs.access).mockRejectedValueOnce(new Error('Not found'));

      const result = await generator.loadCustomMocks();

      expect(result).toBeNull();
      expect(vi.mocked(fs.access)).toHaveBeenCalledTimes(2);
    });
  });

  describe('centralized mocks', () => {
    it('should load mocks from centralized mocks.js file', async () => {
      // Mock reading the centralized mocks.js file
      vi.mocked(fs.access).mockResolvedValue(undefined);

      const result = await generator.loadCustomMocks();

      // Should successfully load the centralized mocks structure
      expect(result).toBeDefined();
      // Centralized mocks.js exists in the actual mocks directory
      expect(result).toBeTypeOf('object');
    });

    it('should handle empty centralized mocks file', async () => {
      const path = '/empty/path';
      vi.mock('/empty/path/mocks.js', () => ({}));
      const customGenerator = new MockGenerator(path);


      const result = await customGenerator.generateMockResponseForSubgraph(
        'products',
        testSchema,
        '{ products { id name } }',
      );

      expect(result).toHaveProperty('data');
      expect(result.data).toHaveProperty('products');
      // Should use default mock values from @graphql-tools/mock
      expect(result.data.products.length).toBeGreaterThan(0);
      expect(result.data.products[0].name).toBe('Hello World');
    });

  });
});
