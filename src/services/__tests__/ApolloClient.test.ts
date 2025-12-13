import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApolloClient as ApolloClientBase } from '@apollo/client/core';
import { ApolloClient, SubgraphSchemaData, SubgraphInfo } from '../../../src/services/ApolloClient';
import { logger } from '../../../src/middleware/requestLogger';
import { createHash } from 'crypto';

// Helper to compute expected schema hash
const computeHash = (sdl: string): string => {
  return createHash('sha256').update(sdl).digest('hex');
};

// Mock @apollo/client
vi.mock('@apollo/client/core', () => {
  const HttpLinkMock = vi.fn().mockImplementation(function(this: any, config: any) {
    Object.assign(this, config);
    return this;
  });

  const InMemoryCacheMock = vi.fn().mockImplementation(function(this: any) {
    return this;
  });

  return {
    ApolloClient: vi.fn(),
    InMemoryCache: InMemoryCacheMock,
    HttpLink: HttpLinkMock,
    gql: vi.fn((strings: TemplateStringsArray) => strings[0]),
  };
});

// Mock logger
vi.mock('../../../src/middleware/requestLogger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('ApolloClient', () => {
  let client: ApolloClient;
  let mockQuery: ReturnType<typeof vi.fn>;

  const mockApiKey = 'test-api-key';
  const mockGraphId = 'test-graph-id';
  const mockVariant = 'current';

  beforeEach(() => {
    mockQuery = vi.fn();

    // Mock the Apollo Client instance as constructor
    vi.mocked(ApolloClientBase).mockImplementation(function(this: any, config: any) {
      this.query = mockQuery;
      Object.assign(this, config);
      return this;
    } as any);

    client = new ApolloClient(mockApiKey, mockGraphId, mockVariant);
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create an Apollo client with correct configuration', () => {
      // Client is created in beforeEach, so verify it exists
      expect(client).toBeInstanceOf(ApolloClient);
    });

    it('should use default environment values when not provided', () => {
      const defaultClient = new ApolloClient();
      expect(defaultClient).toBeInstanceOf(ApolloClient);
    });
  });

  describe('fetchSubgraphSchema', () => {
    const mockSDL = 'type Product { id: ID! }';
    const mockSchemaResponse = {
      data: {
        graph: {
          variant: {
            subgraph: {
              activePartialSchema: {
                sdl: mockSDL,
              },
            },
          },
        },
      },
      errors: undefined,
    };

    it('should fetch subgraph schema successfully', async () => {
      mockQuery.mockResolvedValueOnce(mockSchemaResponse);

      const result = await client.fetchSubgraphSchema('products');

      expect(result).toEqual({
        sdl: mockSDL,
        version: computeHash(mockSDL),
      });

      expect(mockQuery).toHaveBeenCalledWith({
        query: expect.any(String),
        variables: {
          graphId: mockGraphId,
          variant: mockVariant,
          subgraphName: 'products',
        },
      });
    });

    it('should throw error when GraphQL errors are returned', async () => {
      const errorResponse = {
        data: mockSchemaResponse.data,
        error: { message: 'GraphQL error' },
      };

      mockQuery.mockResolvedValueOnce(errorResponse);

      await expect(client.fetchSubgraphSchema('products')).rejects.toThrow('GraphQL error');
    });

    it('should throw error when subgraph not found', async () => {
      const notFoundResponse = {
        data: {
          graph: {
            variant: {
              subgraph: null,
            },
          },
        },
        errors: undefined,
      };

      mockQuery.mockResolvedValueOnce(notFoundResponse);

      await expect(client.fetchSubgraphSchema('nonexistent')).rejects.toThrow(
        'Subgraph nonexistent not found'
      );
    });

    it('should throw error when graph not found', async () => {
      const noGraphResponse = {
        data: {
          graph: null,
        },
        errors: undefined,
      };

      mockQuery.mockResolvedValueOnce(noGraphResponse);

      await expect(client.fetchSubgraphSchema('products')).rejects.toThrow(
        'Subgraph products not found'
      );
    });

    it('should handle network errors', async () => {
      const networkError = new Error('Network error');
      mockQuery.mockRejectedValueOnce(networkError);

      await expect(client.fetchSubgraphSchema('products')).rejects.toThrow('Network error');
    });

    it('should handle various schema sizes', async () => {
      const largeSDL = 'type Product { id: ID! }\n'.repeat(1000);
      const largeResponse = {
        data: {
          graph: {
            variant: {
              subgraph: {
                activePartialSchema: {
                  sdl: largeSDL,
                },
              },
            },
          },
        },
        errors: undefined,
      };

      mockQuery.mockResolvedValueOnce(largeResponse);

      const result = await client.fetchSubgraphSchema('products');
      expect(result.sdl).toBe(largeSDL);
      expect(result.version).toBe(computeHash(largeSDL));
    });
  });

  describe('listSubgraphs', () => {
    const mockSubgraphsResponse = {
      data: {
        graph: {
          variant: {
            subgraphs: [
              { name: 'products', url: 'http://products:4001' },
              { name: 'reviews', url: 'http://reviews:4002' },
            ],
          },
        },
      },
      errors: undefined,
    };

    it('should list all subgraphs successfully', async () => {
      mockQuery.mockResolvedValueOnce(mockSubgraphsResponse);

      const result = await client.listSubgraphs();

      expect(result).toEqual([
        { name: 'products', url: 'http://products:4001' },
        { name: 'reviews', url: 'http://reviews:4002' },
      ]);

      expect(mockQuery).toHaveBeenCalledWith({
        query: expect.any(String),
        variables: {
          graphId: mockGraphId,
          variant: mockVariant,
        },
      });
    });

    it('should return empty array when no subgraphs exist', async () => {
      const emptyResponse = {
        data: {
          graph: {
            variant: {
              subgraphs: [],
            },
          },
        },
        errors: undefined,
      };

      mockQuery.mockResolvedValueOnce(emptyResponse);

      const result = await client.listSubgraphs();
      expect(result).toEqual([]);
    });

    it('should throw error when GraphQL errors are returned', async () => {
      const errorResponse = {
        data: mockSubgraphsResponse.data,
        error: { message: 'GraphQL error' },
      };

      mockQuery.mockResolvedValueOnce(errorResponse);

      await expect(client.listSubgraphs()).rejects.toThrow('GraphQL error');
    });

    it('should handle network errors', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Network error'));

      await expect(client.listSubgraphs()).rejects.toThrow('Network error');
    });
  });

  describe('fetchMultipleSchemas', () => {
    it('should fetch multiple schemas in parallel', async () => {
      const sdl1 = 'type Product { id: ID! }';
      const sdl2 = 'type Review { id: ID! }';

      const schema1 = {
        data: {
          graph: {
            variant: {
              subgraph: {
                activePartialSchema: {
                  sdl: sdl1,
                },
              },
            },
          },
        },
        errors: undefined,
      };

      const schema2 = {
        data: {
          graph: {
            variant: {
              subgraph: {
                activePartialSchema: {
                  sdl: sdl2,
                },
              },
            },
          },
        },
        errors: undefined,
      };

      mockQuery
        .mockResolvedValueOnce(schema1)
        .mockResolvedValueOnce(schema2);

      const result = await client.fetchMultipleSchemas(['products', 'reviews']);

      expect(result.size).toBe(2);
      expect(result.get('products')).toEqual({
        sdl: sdl1,
        version: computeHash(sdl1),
      });
      expect(result.get('reviews')).toEqual({
        sdl: sdl2,
        version: computeHash(sdl2),
      });
    });

    it('should continue with other schemas if one fails', async () => {
      const sdl = 'type Product { id: ID! }';
      const successSchema = {
        data: {
          graph: {
            variant: {
              subgraph: {
                activePartialSchema: {
                  sdl,
                },
              },
            },
          },
        },
        errors: undefined,
      };

      mockQuery
        .mockRejectedValueOnce(new Error('Failed'))
        .mockResolvedValueOnce(successSchema);

      const result = await client.fetchMultipleSchemas(['failed', 'products']);

      expect(result.size).toBe(1);
      expect(result.get('products')).toBeDefined();
      expect(result.get('products')?.version).toBe(computeHash(sdl));
      expect(result.get('failed')).toBeUndefined();
    });

    it('should return empty map for empty input', async () => {
      const result = await client.fetchMultipleSchemas([]);
      expect(result.size).toBe(0);
    });
  });

  describe('verifyConnection', () => {
    it('should verify connection successfully', async () => {
      const verifyResponse = {
        data: {
          graph: {
            id: mockGraphId,
            name: 'Test Graph',
          },
        },
        errors: undefined,
      };

      mockQuery.mockResolvedValueOnce(verifyResponse);

      const result = await client.verifyConnection();

      expect(result).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith({
        query: expect.any(String),
        variables: {
          graphId: mockGraphId,
        },
      });
    });

    it('should throw error when graph not found', async () => {
      const notFoundResponse = {
        data: {
          graph: null,
        },
        errors: undefined,
      };

      mockQuery.mockResolvedValueOnce(notFoundResponse);

      await expect(client.verifyConnection()).rejects.toThrow('not found or not accessible');
    });

    it('should throw error on GraphQL errors', async () => {
      const errorResponse = {
        data: { graph: null },
        error: { message: 'Unauthorized' },
      };

      mockQuery.mockResolvedValueOnce(errorResponse);

      await expect(client.verifyConnection()).rejects.toThrow('GraphQL error');
    });

    it('should handle network errors', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Network error'));

      await expect(client.verifyConnection()).rejects.toThrow('Network error');
    });
  });

  describe('error handling', () => {
    it('should log errors appropriately', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Test error'));

      await expect(client.fetchSubgraphSchema('products')).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          subgraphName: 'products',
        }),
        '[ApolloClient] Failed to fetch schema'
      );
    });
  });
});
