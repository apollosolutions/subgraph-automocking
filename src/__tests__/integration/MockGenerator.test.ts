import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildSchema } from 'graphql';
import { MockGenerator } from '../../services/MockGenerator';
import { promises as fs } from 'fs';
import path from 'path';

describe('MockGenerator Integration Tests', () => {
  let generator: MockGenerator;
  const testMocksDir = path.join(process.cwd(), '_tests', 'fixtures', 'mocks');

  beforeEach(() => {
    generator = new MockGenerator(testMocksDir);
  });

  afterEach(async () => {
    // Clear cached mocks structure between tests
    generator.clearCustomMocks();

    // Clean up test fixtures
    try {
      await fs.rm(testMocksDir, { recursive: true, force: true });
    } catch {
      // Ignore errors
    }
  });

  describe('Mock File Detection - error handling', () => {
    beforeEach(async () => {
      // Create test mocks directory
      await fs.mkdir(testMocksDir, { recursive: true });
    });

    it('should detect TypeScript mock file and return undefined', async () => {
      // Create a .ts mock file
      const tsMockPath = path.join(testMocksDir, 'test-ts.ts');
      await fs.writeFile(tsMockPath, `
        export const mocks = {
          _globals: {
            String: () => 'Global String',
            Int: () => 42
          },
          products: {
            Product: () => ({ name: () => 'TS Product' })
          }
        };
      `);

      const result = await generator.loadCustomMocks();

      // TypeScript files should not be loaded at runtime
      expect(result).toBeNull();
    });

    it('should return undefined when file not found', async () => {
      // Don't create any files
      const result = await generator.loadCustomMocks();

      expect(result).toBeNull();
    });

    it('should handle import errors gracefully', async () => {
      const badMockPath = path.join(testMocksDir, 'bad-syntax.js');
      await fs.writeFile(badMockPath, `
        this is invalid javascript syntax
      `);

      const result = await generator.loadCustomMocks();

      // Should return undefined on import error
      expect(result).toBeNull();
    });
  });

  describe('Mock File Detection', () => {
    beforeEach(async () => {
      // Create test mocks directory
      await fs.mkdir(testMocksDir, { recursive: true });
      const jsMockPath = path.join(testMocksDir, 'mocks.js');
      await fs.writeFile(jsMockPath, `
        export const mocks = {
          _globals: {
            String: () => 'Global String',
            Int: () => 42
          },
          'test-js': {
            Product: () => ({
              name: () => 'JS Product',
              id: () => 'js-123'
            })
          },
          products: {
            Product: () => ({ name: () => 'Named Export' }),
            Query: () => ({ products: () => [] })
          },
          cacheable: {
            Product: () => ({ name: () => 'Cached' })
          }
        };
      `);
    });

    it('should load JavaScript mock file successfully', async () => {
      // Create centralized mocks.js file with ALL subgraph mocks to avoid caching issues

      const result = await generator.loadCustomMocks();

      expect(result).toBeDefined();
      expect(result).toHaveProperty('_globals');
      expect(result).toHaveProperty('cacheable');
      expect(result).toHaveProperty('products');
      expect(result).toHaveProperty('test-js');
    });

    it('should handle mock module with named export', async () => {
      const subgraphName = 'products';

      const result = await generator.loadCustomMocks();

      expect(result).toBeDefined();
      expect(result).toHaveProperty(subgraphName);
      expect(result[subgraphName]).toHaveProperty('Product');
      expect(result[subgraphName]).toHaveProperty('Query');
      expect(result._globals).toHaveProperty('String'); // Includes globals
      expect(result._globals).toHaveProperty('Int'); // Includes globals
    });

    it('should cache loaded JavaScript mocks', async () => {
      const result1 = await generator.loadCustomMocks();
      const result2 = await generator.loadCustomMocks();

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
      expect(result1).toBe(result2); // Same cached instance
    });

  });

  describe('Operation Name Handling', () => {
    const schema = buildSchema(`
      type Product {
        id: ID!
        name: String!
      }

      type Query {
        product(id: ID!): Product
        products: [Product!]!
      }
    `);

    it('should execute correct operation when operationName specified', async () => {
      const query = `
        query GetProduct {
          product(id: "1") { id name }
        }

        query GetProducts {
          products { id name }
        }
      `;

      const result = await generator.generateMockResponseForSubgraph(
        'test',
        schema,
        query,
        undefined,
        'GetProduct'
      );

      expect(result.data).toBeDefined();
      expect(result.errors).toBeUndefined();
      expect((result.data as any).product).toBeDefined();
      expect((result.data as any).products).toBeUndefined();
    });

    it('should execute a specific named operation when specified', async () => {
      const query = `
        query GetProduct {
          product(id: "1") { id }
        }

        query GetProducts {
          products { id }
        }
      `;

      const result = await generator.generateMockResponseForSubgraph(
        'test',
        schema,
        query,
        undefined,
        'GetProducts'
      );

      expect(result.data).toBeDefined();
      expect((result.data as any).products).toBeDefined();
      expect((result.data as any).product).toBeUndefined();
    });

    it('should handle mutations with operationName', async () => {
      const mutationSchema = buildSchema(`
        type Product {
          id: ID!
          name: String!
        }

        type Query {
          products: [Product!]!
        }

        type Mutation {
          createProduct(name: String!): Product!
          updateProduct(id: ID!, name: String!): Product!
        }
      `);

      const mutation = `
        mutation CreateProduct {
          createProduct(name: "New Product") { id name }
        }

        mutation UpdateProduct {
          updateProduct(id: "1", name: "Updated") { id name }
        }
      `;

      const result = await generator.generateMockResponseForSubgraph(
        'test',
        mutationSchema,
        mutation,
        undefined,
        'CreateProduct'
      );

      expect(result.data).toBeDefined();
      expect((result.data as any).createProduct).toBeDefined();
      expect((result.data as any).updateProduct).toBeUndefined();
    });

    it('should work with variables and operationName together', async () => {
      const query = `
        query GetProduct($id: ID!) {
          product(id: $id) { id name }
        }

        query GetProducts {
          products { id }
        }
      `;

      const result = await generator.generateMockResponseForSubgraph(
        'test',
        schema,
        query,
        { id: '123' },
        'GetProduct'
      );

      expect(result.data).toBeDefined();
      expect(result.errors).toBeUndefined();
    });

    it('should handle undefined operationName gracefully', async () => {
      const singleQuery = `query { products { id } }`;

      const result = await generator.generateMockResponseForSubgraph(
        'test',
        schema,
        singleQuery,
        undefined,
        undefined
      );

      expect(result.data).toBeDefined();
      expect(result.errors).toBeUndefined();
    });
  });

  describe('Mock Response with Subgraph Integration', () => {
    beforeEach(async () => {
      await fs.mkdir(testMocksDir, { recursive: true });
    });

    it('should use loaded custom mocks in generateMockResponseForSubgraph', async () => {
      const schema = buildSchema(`
        type Product { id: ID!, name: String! }
        type Query { products: [Product!]! }
      `);

      const mockPath = path.join(testMocksDir, 'mocks.js');
      await fs.writeFile(mockPath, `
        module.exports = {
          _globals: {
            String: () => 'Global String'
          },
          products: {
            Product: () => ({
              id: () => 'custom-id',
              name: () => 'Custom Product'
            })
          }
        };
      `);

      const result = await generator.generateMockResponseForSubgraph(
        'products',
        schema,
        '{ products { id name } }'
      );

      expect(result.data).toBeDefined();
      expect(result.errors).toBeUndefined();
    });

    it('should handle operationName in generateMockResponseForSubgraph', async () => {
      const schema = buildSchema(`
        type Product { id: ID! }
        type Query {
          product(id: ID!): Product
          products: [Product!]!
        }
      `);

      const query = `
        query GetProduct { product(id: "1") { id } }
        query GetProducts { products { id } }
      `;

      const result = await generator.generateMockResponseForSubgraph(
        'test',
        schema,
        query,
        undefined,
        'GetProduct'
      );

      expect(result.data).toBeDefined();
      expect((result.data as any).product).toBeDefined();
    });
  });
});
