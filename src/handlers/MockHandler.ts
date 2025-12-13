import { Request, Response } from 'express';
import { SchemaCache } from '../services/SchemaCache';
import { MockGenerator } from '../services/MockGenerator';
import { IMocks } from '@graphql-tools/mock';
import { GraphQLSchema } from 'graphql';
import { logger } from '../middleware/requestLogger';
import { isIntrospectionQuery } from '../utils/queryUtils';
import { printSubgraphSchema } from '@apollo/subgraph';


/**
 * MockHandler generates mock GraphQL responses based on schema definitions.
 *
 * This handler:
 * - Retrieves schemas from the SchemaCache
 * - Generates realistic mock data using @graphql-tools/mock
 * - Supports custom mock resolvers loaded from the mocks/ directory
 * - Preserves mock consistency using seeded random generation
 * - Handles errors gracefully with detailed error messages
 *
 * @example
 * ```typescript
 * const handler = new MockHandler(schemaCache, mockGenerator);
 * await handler.handleRequest(req, res, 'products-subgraph');
 * ```
 */
export class MockHandler {
  private customMocks: Map<string, IMocks> = new Map();

  constructor(
    private readonly schemaCache: SchemaCache,
    private readonly mockGenerator: MockGenerator
  ) {
    void this.mockGenerator.loadCustomMocks();
  }

  /**
   * Generate and return a mock GraphQL response.
   *
   * This method:
   * - Validates the request contains a GraphQL query
   * - Retrieves the appropriate schema for the subgraph
   * - Loads custom mocks if they exist for the subgraph
   * - Generates mock data using the schema and custom resolvers
   * - Returns the mock response with appropriate headers
   *
   * @param req - Express request object containing the GraphQL query
   * @param res - Express response object for sending the mock response
   * @param subgraphName - Name of the subgraph to mock
   *
   * @example
   * ```typescript
   * await handler.handleRequest(req, res, 'products');
   * // Response includes X-Mock-Response and X-Mock-Subgraph headers
   * ```
   */
  public async handleRequest(
    req: Request,
    res: Response,
    subgraphName: string
  ): Promise<void> {
    try {
      logger.info({ subgraphName }, '[Mock] Generating mock response');

      // Extract GraphQL query from request body
      const body = req.body as { query?: unknown; variables?: unknown; operationName?: unknown };
      const { query, variables, operationName } = body;

      // Validate request has a query
      if (!query) {
        res.status(400).json({
          errors: [
            {
              message: 'No query provided',
              extensions: {
                code: 'BAD_REQUEST',
              },
            },
          ],
        });
        return;
      }

      // Validate query is a string
      if (typeof query !== 'string') {
        res.status(400).json({
          errors: [
            {
              message: 'Query must be a string',
              extensions: {
                code: 'BAD_REQUEST',
              },
            },
          ],
        });
        return;
      }

      // Get schema for the subgraph
      const schema = await this.getSchemaOrError(subgraphName, res);
      if (!schema) {
        return; // Error response already sent
      }

      // Check if this is a federation introspection query
      if (isIntrospectionQuery(query)) {
        this.handleIntrospectionQuery(schema, subgraphName, res);
        return;
      }

      // Generate mock response
      const result = await this.mockGenerator.generateMockResponseForSubgraph(
        subgraphName,
        schema,
        query,
        variables as Record<string | number, unknown> | undefined,
        operationName as string | undefined,
      );

      // Add headers to indicate this is a mock response
      res.setHeader('X-Mock-Response', 'true');
      res.setHeader('X-Mock-Subgraph', subgraphName);
      res.setHeader('X-Proxy-Mode', 'mock');


      // Return the mock data with standard GraphQL response format
      res.status(200).json(result);
    } catch (error) {
      this.handleError(error as Error, subgraphName, res);
    }
  }

  /**
   * Get schema from cache or send error response
   *
   * Attempts to retrieve the schema from the cache. If the schema is not found,
   * sends a standardized 404 error response and returns null.
   *
   * @param subgraphName - Name of the subgraph
   * @param res - Express response object
   * @returns GraphQLSchema if found, null if error response was sent
   * @private
   */
  private async getSchemaOrError(
    subgraphName: string,
    res: Response
  ): Promise<GraphQLSchema | null> {
    try {
      return await this.schemaCache.getSchema(subgraphName);
    } catch (error) {
      logger.error({ subgraphName, error }, '[Mock] Failed to retrieve schema');
      res.status(404).json({
        errors: [
          {
            message: `Schema not found for subgraph: ${subgraphName}`,
            extensions: {
              code: 'SCHEMA_NOT_FOUND',
              subgraph: subgraphName,
            },
          },
        ],
      });
      return null;
    }
  }

  /**
   * Handle introspection query response
   *
   * Generates and sends the SDL response for a federation introspection query.
   *
   * @param schema - GraphQL schema to introspect
   * @param subgraphName - Name of the subgraph
   * @param res - Express response object
   * @private
   */
  private handleIntrospectionQuery(
    schema: GraphQLSchema,
    subgraphName: string,
    res: Response
  ): void {
    logger.info({ subgraphName }, '[Mock] Detected introspection query');

    const sdl = printSubgraphSchema(schema);

    res.setHeader('X-Mock-Response', 'true');
    res.setHeader('X-Mock-Subgraph', subgraphName);
    res.setHeader('X-Proxy-Mode', 'mock-introspection');

    res.status(200).json({
      data: {
        _service: {
          sdl,
        },
      },
    });
  }

  /**
   * Handle errors that occur during mock generation.
   *
   * This provides detailed error responses for different error scenarios:
   * - Schema validation errors
   * - Query parsing errors
   * - Mock generation failures
   * - Internal errors
   *
   * @param error - The error that occurred
   * @param subgraphName - The subgraph name being mocked
   * @param res - Express response object
   *
   * @private
   */
  private handleError(error: Error, subgraphName: string, res: Response): void {
    logger.error({ subgraphName, error }, '[Mock] Error generating mock');

    // Determine appropriate status code and error details
    let statusCode = 500;
    let errorCode = 'MOCK_GENERATION_ERROR';
    let message = 'Failed to generate mock response';

    // Check for specific error types
    if (error.message.includes('parse') || error.message.includes('syntax')) {
      statusCode = 400;
      errorCode = 'GRAPHQL_PARSE_ERROR';
      message = 'Invalid GraphQL query';
    } else if (error.message.includes('validation')) {
      statusCode = 400;
      errorCode = 'GRAPHQL_VALIDATION_ERROR';
      message = 'Query validation failed';
    } else if (error.message.includes('schema')) {
      statusCode = 500;
      errorCode = 'SCHEMA_ERROR';
      message = 'Schema processing error';
    }

    res.status(statusCode).json({
      errors: [
        {
          message,
          extensions: {
            code: errorCode,
            subgraph: subgraphName,
            details: error.message,
          },
        },
      ],
    });
  }

  /**
   * Get the list of loaded custom mock subgraphs.
   *
   * Useful for debugging and monitoring which custom mocks are available.
   *
   * @returns Array of subgraph names that have custom mocks loaded
   *
   * @example
   * ```typescript
   * const subgraphs = handler.getLoadedMockSubgraphs();
   * console.log('Custom mocks available for:', subgraphs);
   * ```
   */
  public getLoadedMockSubgraphs(): string[] {
    return Array.from(this.customMocks.keys());
  }
}
