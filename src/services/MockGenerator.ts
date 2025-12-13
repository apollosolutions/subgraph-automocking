import { GraphQLSchema, graphql, GraphQLError } from 'graphql';
import { addMocksToSchema, IMocks } from '@graphql-tools/mock';
import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../middleware/requestLogger';

/**
 * Options for configuring mock response generation
 */
export interface MockOptions {
  /** Custom mock resolvers to override defaults */
  mocks?: IMocks;
}

/**
 * Result of a mock query execution
 */
export interface MockResult {
  /** Query result data */
  data?: unknown;
  /** GraphQL errors if any occurred */
  errors?: readonly GraphQLError[];
}

/**
 * Input structure of the centralized mocks.js file
 */
interface CustomMocksInput {
  /** Global mocks applied to all subgraphs */
  _globals?: IMocks;
  /** Subgraph-specific mocks that override globals */
  [subgraphName: string]: IMocks | undefined;
}

/**
 * Generator for GraphQL mock responses
 *
 * Uses @graphql-tools/mock to generate realistic mock data for GraphQL queries.
 * Supports custom mock resolvers loaded from a centralized mocks.js file with
 * global defaults (_globals) and subgraph-specific overrides.
 *
 * @example
 * ```typescript
 * // mocks/mocks.js
 * export default {
 *   _globals: {
 *     Int: () => 123,
 *     String: () => "test",
 *   },
 *   products: {
 *     Int: () => 456, // Overrides global Int for products subgraph
 *   },
 * };
 *
 * // Usage
 * const generator = new MockGenerator();
 * await generator.loadCustomMocks('products');
 * const result = await generator.generateMockResponse(
 *   schema,
 *   'query { products { id name } }'
 * );
 * console.log(result.data);
 * ```
 */
export class MockGenerator {
  private customMocks: Map<string, IMocks> = new Map();
  private mocksInput: CustomMocksInput | null = null;
  private readonly mocksDirectory: string;

  /**
   * Creates a new MockGenerator
   *
   * @param mocksDirectory - Directory containing the centralized mocks.js file (default: './config/mocks.js')
   */
  constructor(mocksDirectory: string = path.join(process.cwd(), 'config')) {
    this.mocksDirectory = mocksDirectory;
  }

  /**
   * Load mocks from mocks.js
   *
   * Loads the centralized mocks.js file containing _globals and subgraph-specific mocks.
   * This file is loaded once and cached for all subgraphs.
   *
   * @returns Promise resolving to the mocks structure, or null if not found
   *
   * @example
   * ```typescript
   * // mocks/mocks.js
   * export const mocks  = {
   *   _globals: {
   *     Int: () => 123,
   *     String: () => "test",
   *   },
   *   products: {
   *     Int: () => 456,
   *   },
   * };
   * ```
   */
  public async loadCustomMocks(): Promise<CustomMocksInput | null> {
    if (this.mocksInput !== null) {
      return this.mocksInput;
    }

    try {
      const mockFile = path.join(this.mocksDirectory, 'mocks.js');

      // Check if file exists
      try {
        await fs.access(mockFile);
      } catch {
        // Try TypeScript extension
        const tsMockFile = path.join(this.mocksDirectory, 'mocks.ts');
        try {
          await fs.access(tsMockFile);
          // File exists, but we need to compile it first in production
          logger.warn('[MockGenerator] Found TypeScript mocks file, but runtime loading not supported');
          return null;
        } catch {
          // No centralized mocks file
          logger.info('[MockGenerator] No centralized mocks.js file found');
          return null;
        }
      }

      // Load the mocks module
      const mocksModule = (await import(mockFile)) as { mocks: CustomMocksInput };

      if (!mocksModule.mocks) {
        logger.warn('[MockGenerator] No "mocks" object exported in mocks.js file');
        return null;
      }

      this.mocksInput = mocksModule.mocks;

      logger.info('[MockGenerator] Loaded centralized mocks structure');
      return this.mocksInput;
    } catch (error) {
      logger.error({ error }, '[MockGenerator] Failed to load centralized mocks structure');
      return null;
    }
  }

  /**
   * Merge mocks in order of precedence
   *
   * Combines mocks in order of precedence, with the last mocks taking precedence.
   *
   * @param mocks - Mocks to merge in order of precedence
   * @returns Merged mocks
   */
  private mergeMocks(...mocks: (IMocks | undefined)[]): IMocks {
    return mocks.reduce<IMocks>((acc, mock) => ({ ...acc, ...(mock ?? {}) }), {});
  }

  /**
   * Build custom mocks for a specific subgraph
   *
   * Builds mocks from the centralized mocks.js file and merges _globals with
   * subgraph-specific mocks. Subgraph mocks override global mocks.
   *
   * @param subgraphName - Name of the subgraph
   * @returns Promise resolving to the merged mocks, or undefined if not found
   *
   * @example
   * ```typescript
   * // mocks/mocks.js
   * export default {
   *   _globals: {
   *     Int: () => 123,
   *     String: () => "test",
   *   },
   *   products: {
   *     Int: () => 456, // Overrides global Int
   *   },
   * };
   *
   * // Usage
   * const mocks = await generator.loadCustomMocks('products');
   * // mocks = { Int: () => 456, String: () => "test" }
   * ```
   */
  private async buildCustomMocks(subgraphName: string): Promise<IMocks | undefined> {
    try {
      // Load the centralized mocks structure
      const mocksInput = await this.loadCustomMocks();

      if (!mocksInput) {
        logger.info({ subgraphName }, '[MockGenerator] No custom mocks found');
        return undefined;
      }

      // Get global and subgraph-specific mocks
      const globals = mocksInput._globals;
      const subgraphMocks = mocksInput[subgraphName];

      // Merge mocks with subgraph taking precedence
      const mergedMocks = this.mergeMocks(globals, subgraphMocks);

      // Cache the merged mocks
      this.customMocks.set(subgraphName, mergedMocks);

      logger.info(
        { subgraphName, hasGlobals: !!globals, hasSubgraphMocks: !!subgraphMocks },
        '[MockGenerator] Loaded and merged custom mocks'
      );

      return mergedMocks;
    } catch (error) {
      logger.error({ subgraphName, error }, '[MockGenerator] Failed to load custom mocks');
      return undefined;
    }
  }

  /**
   * Get custom mocks for a subgraph
   *
   * Returns previously loaded custom mocks for a subgraph
   * or builds them if they haven't been built yet.
   *
   * @param subgraphName - Name of the subgraph
   * @returns Custom mocks if loaded, undefined otherwise
   */
  public async getCustomMocks(subgraphName: string): Promise<IMocks | undefined> {
    const customMocks = this.customMocks.get(subgraphName);
    if (customMocks) {
      return customMocks;
    }
    return this.buildCustomMocks(subgraphName);
  }

  /**
   * Generate mock response for a GraphQL query
   *
   * Executes a GraphQL query against a mocked version of the schema.
   * The schema is augmented with mock resolvers that generate realistic
   * test data. Custom mocks are automatically loaded for the specified
   * subgraph (if available) and merged with any additional options provided.
   *
   * @param subgraphName - Name of the subgraph
   * @param schema - GraphQL schema to mock
   * @param query - GraphQL query string to execute
   * @param variables - Query variables
   * @param operationName - Operation name if query contains multiple operations
   * @param options - Additional mock generation options
   * @returns Promise resolving to mock query result
   *
   * @example
   * ```typescript
   * const result = await generator.generateMockResponseForSubgraph(
   *   'products',
   *   schema,
   *   'query GetProduct($id: ID!) { product(id: $id) { id name price } }',
   *   { id: '123' }
   * );
   *
   * if (result.data) {
   *   console.log(result.data.product);
   * }
   * ```
   */
  public async generateMockResponseForSubgraph(
    subgraphName: string,
    schema: GraphQLSchema,
    query: string,
    variables?: Record<string, unknown>,
    operationName?: string,
    options: MockOptions = {}
  ): Promise<MockResult> {
    try {
      // Load custom mocks for this subgraph
      const customMocks = await this.getCustomMocks(subgraphName);

      // Merge custom mocks with provided options (custom mocks take precedence)
      const mocks = this.mergeMocks(customMocks, options.mocks);

      // Add mocks to the schema
      const mockedSchema = addMocksToSchema({
        schema,
        mocks,
      });

      // Execute query against mocked schema
      const graphqlResult = await graphql({
        schema: mockedSchema,
        source: query,
        variableValues: variables,
        operationName,
      });

      const mockResult: MockResult = {
        data: graphqlResult.data,
      };

      if (graphqlResult.errors !== undefined) {
        mockResult.errors = graphqlResult.errors;
      }

      return mockResult;
    } catch (error) {
      logger.error({ err: error }, '[MockGenerator] Error generating mock response');
      throw error;
    }
  }

  /**
   * Clear all loaded custom mocks
   *
   * Removes all custom mocks from memory and clears the cached mocks structure.
   * Useful for testing or when you want to reload mocks from disk.
   */
  public clearCustomMocks(): void {
    this.customMocks.clear();
    this.mocksInput = null;
    logger.info('[MockGenerator] Cleared all custom mocks and cached structure');
  }
}
