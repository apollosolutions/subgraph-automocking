/**
 * Utility functions for GraphQL query processing
 */

export type IntrospectionQueryResult = {
  data: {
    _service: {
      sdl: string;
    };
  } | null;
  errors?: unknown[];
};


/**
 * The federation introspection query used by Apollo Router
 * to fetch subgraph SDL
 */
export const FEDERATION_INTROSPECTION_QUERY = `
  query SubgraphIntrospectQuery {
    # eslint-disable-next-line
    _service {
      sdl
    }
  }
`.trim();


/**
 * Normalize a GraphQL query by removing all whitespace, newlines, and comments
 *
 * This allows for flexible comparison of queries regardless of formatting.
 *
 * @param query - The GraphQL query to normalize
 * @returns Normalized query string with whitespace and comments removed
 *
 * @example
 * ```typescript
 * normalizeQuery('query { \n  user { id } }');
 * // Returns: 'query{user{id}}'
 * ```
 */
export function normalizeQuery(query: string): string {
  return query
    // Remove comments
    .replace(/#[^\n]*/g, '')
    // Remove all whitespace (spaces, tabs, newlines)
    .replace(/\s+/g, '')
    // Normalize to lowercase for case-insensitive comparison
    .toLowerCase();
}

/**
 * Check if a query is the federation introspection query
 *
 * @param query - The GraphQL query to check
 * @returns True if the query matches the federation introspection query
 *
 * @example
 * ```typescript
 * isIntrospectionQuery('query { _service { sdl } }'); // true
 * isIntrospectionQuery('query { users { id } }'); // false
 * ```
 */
export function isIntrospectionQuery(query: string): boolean {
  const normalizedQuery = normalizeQuery(query);
  const normalizedIntrospection = normalizeQuery(FEDERATION_INTROSPECTION_QUERY);

  return normalizedQuery === normalizedIntrospection;
}
