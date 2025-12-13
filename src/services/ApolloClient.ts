import { ApolloClient as ApolloClientBase, InMemoryCache, HttpLink, gql, TypedDocumentNode } from '@apollo/client/core';
import fetch from 'cross-fetch';
import { env } from '../config/environment';
import { logger } from '../middleware/requestLogger';
import { GetSubgraphSchemaQuery, GetSubgraphSchemaQueryVariables, ListSubgraphsQuery, ListSubgraphsQueryVariables, VerifyConnectionQuery, VerifyConnectionQueryVariables } from '../generated/graphql';
import { createHash } from 'crypto';

/**
 * Represents schema data fetched from Apollo Platform
 */
export interface SubgraphSchemaData {
  /** Schema Definition Language (SDL) string */
  sdl: string;
  /** Schema version identifier (hash) */
  version: string;
}

/**
 * Represents subgraph information from Apollo Platform
 */
export interface SubgraphInfo {
  /** Subgraph name */
  name: string;
  /** Subgraph GraphQL endpoint URL */
  url: string | null | undefined;
}

/**
 * Client for interacting with Apollo Platform API
 *
 * Provides methods for fetching subgraph schemas and metadata from the
 * Apollo Platform GraphQL API. Uses @apollo/client for making GraphQL
 * requests with proper authentication and error handling.
 *
 * @example
 * ```typescript
 * const client = new ApolloClient();
 * const schema = await client.fetchSubgraphSchema('products');
 * console.log(schema.sdl);
 * ```
 */
export class ApolloClient {
  private client: ApolloClientBase;

  /**
   * Creates a new ApolloClient for Platform API access
   *
   * @param apiKey - Apollo Platform API key for authentication
   * @param graphId - Apollo graph identifier
   * @param variant - Graph variant name (e.g., 'current', 'staging')
   */
  constructor(
    private readonly apiKey: string = env.APOLLO_KEY,
    private readonly graphId: string = env.APOLLO_GRAPH_ID,
    private readonly variant: string = env.APOLLO_GRAPH_VARIANT
  ) {
    // Create Apollo Client configured for Apollo Platform API
    this.client = new ApolloClientBase({
      link: new HttpLink({
        uri: 'https://graphql.api.apollographql.com/api/graphql',
        headers: {
          'x-api-key': this.apiKey,
          'apollographql-client-name': 'mocking-proxy',
          'apollographql-client-version': '1.0.0',
        },
        fetch,
      }),
      cache: new InMemoryCache(),
      defaultOptions: {
        query: {
          fetchPolicy: 'no-cache',
        },
      },
    });
  }

  /**
   * Fetch subgraph schema from Apollo Platform
   *
   * Retrieves the active schema (SDL) and version for a specific subgraph
   * from the Apollo Platform API. The schema is returned as SDL which can
   * be built into a GraphQLSchema object.
   *
   * @param subgraphName - Name of the subgraph to fetch
   * @returns Promise resolving to schema data (SDL and version)
   * @throws {Error} If the subgraph is not found or API request fails
   *
   * @example
   * ```typescript
   * const schemaData = await client.fetchSubgraphSchema('products');
   * const schema = buildSchema(schemaData.sdl);
   * console.log(`Schema version: ${schemaData.version}`);
   * ```
   */
  public async fetchSubgraphSchema(subgraphName: string): Promise<SubgraphSchemaData> {
    const query: TypedDocumentNode<GetSubgraphSchemaQuery, GetSubgraphSchemaQueryVariables> = gql`
      query GetSubgraphSchema($graphId: ID!, $variant: String!, $subgraphName: ID!) {
        graph(id: $graphId) {
          variant(name: $variant) {
            subgraph(name: $subgraphName) {
              activePartialSchema {
                sdl
              }
            }
          }
        }
      }
    `;

    try {
      const result = await this.client.query({
        query,
        variables: {
          graphId: this.graphId,
          variant: this.variant,
          subgraphName,
        },
      });

      logger.debug({ result }, '[ApolloClient] Fetch subgraph schema result');

      if (result.error) {
        throw new Error(`GraphQL error: ${JSON.stringify(result.error)}`);
      }

      const subgraphData = result.data?.graph?.variant?.subgraph;

      if (!subgraphData) {
        throw new Error(`Subgraph ${subgraphName} not found in graph ${this.graphId}@${this.variant}`);
      }

      return {
        sdl: subgraphData.activePartialSchema.sdl,
        version: this.generateSchemaHash(subgraphData.activePartialSchema.sdl),
      };
    } catch (error) {
      logger.error({ error, subgraphName }, '[ApolloClient] Failed to fetch schema');
      throw error;
    }
  }

  /**
   * List all subgraphs in the graph
   *
   * Retrieves a list of all subgraphs configured in the specified graph
   * variant. Returns both subgraph names and their GraphQL endpoint URLs.
   *
   * @returns Promise resolving to array of subgraph information
   * @throws {Error} If API request fails
   *
   * @example
   * ```typescript
   * const subgraphs = await client.listSubgraphs();
   * subgraphs.forEach(sub => {
   *   console.log(`${sub.name}: ${sub.url}`);
   * });
   * ```
   */
  public async listSubgraphs(): Promise<SubgraphInfo[]> {
    const query: TypedDocumentNode<ListSubgraphsQuery, ListSubgraphsQueryVariables> = gql`
      query ListSubgraphs($graphId: ID!, $variant: String!) {
        graph(id: $graphId) {
          variant(name: $variant) {
            subgraphs {
              name
              url
            }
          }
        }
      }
    `;

    try {
      const result = await this.client.query({
        query,
        variables: {
          graphId: this.graphId,
          variant: this.variant,
        },
      });

      if (result.error) {
        throw new Error(`GraphQL error: ${JSON.stringify(result.error)}`);
      }

      const subgraphs = result.data?.graph?.variant?.subgraphs || [];
      return subgraphs.map(s => ({
        name: s.name,
        url: s.url,
      }));
    } catch (error) {
      logger.error({ error }, '[ApolloClient] Failed to list subgraphs');
      throw error;
    }
  }

  /**
   * Fetch multiple subgraph schemas in parallel
   *
   * Efficient method for fetching schemas for multiple subgraphs at once.
   * Requests are made in parallel to minimize total fetch time.
   *
   * @param subgraphNames - Array of subgraph names to fetch
   * @returns Promise resolving to map of subgraph names to schema data
   * @throws {Error} If any schema fetch fails (partial failures are included in result)
   *
   * @example
   * ```typescript
   * const schemas = await client.fetchMultipleSchemas(['products', 'reviews']);
   * console.log(schemas.get('products')?.sdl);
   * ```
   */
  public async fetchMultipleSchemas(
    subgraphNames: string[]
  ): Promise<Map<string, SubgraphSchemaData>> {
    const results = new Map<string, SubgraphSchemaData>();

    const fetchPromises = subgraphNames.map(async (name) => {
      try {
        const schema = await this.fetchSubgraphSchema(name);
        results.set(name, schema);
      } catch (error) {
        logger.error({ error, subgraphName: name }, '[ApolloClient] Failed to fetch schema');
        // Continue with other schemas even if one fails
      }
    });

    await Promise.all(fetchPromises);

    return results;
  }

  /**
   * Verify API connectivity and authentication
   *
   * Performs a simple query to verify that the API key is valid and
   * the graph can be accessed. Useful for health checks and startup validation.
   *
   * @returns Promise resolving to true if connection is successful
   * @throws {Error} If authentication fails or graph is not accessible
   *
   * @example
   * ```typescript
   * try {
   *   await client.verifyConnection();
   *   console.log('Apollo Platform API connection verified');
   * } catch (error) {
   *   console.error('Failed to connect to Apollo Platform API');
   * }
   * ```
   */
  public async verifyConnection(): Promise<boolean> {
    const query: TypedDocumentNode<VerifyConnectionQuery, VerifyConnectionQueryVariables> = gql`
      query VerifyConnection($graphId: ID!) {
        graph(id: $graphId) {
          id
          name
        }
      }
    `;

    try {
      const result = await this.client.query({
        query,
        variables: {
          graphId: this.graphId,
        },
      });

      if (result.error) {
        throw new Error(`GraphQL error: ${JSON.stringify(result.error)}`);
      }

      if (!result.data?.graph) {
        throw new Error(`Graph ${this.graphId} not found or not accessible`);
      }

      logger.info({ graphName: result.data.graph.name, graphId: result.data.graph.id }, '[ApolloClient] Connected to graph');
      return true;
    } catch (error) {
      logger.error({ error }, '[ApolloClient] Connection verification failed');
      throw error;
    }
  }

  public generateSchemaHash(schema: string): string {
    return createHash('sha256').update(schema).digest('hex');
  }
}
