import { describe, it, expect } from 'vitest';
import {
  normalizeQuery,
  isIntrospectionQuery,
  FEDERATION_INTROSPECTION_QUERY,
} from '../queryUtils';

describe('queryUtils', () => {
  describe('normalizeQuery', () => {
    it('should remove whitespace', () => {
      const query = 'query { user { id } }';
      expect(normalizeQuery(query)).toBe('query{user{id}}');
    });

    it('should remove newlines', () => {
      const query = 'query {\n  user {\n    id\n  }\n}';
      expect(normalizeQuery(query)).toBe('query{user{id}}');
    });

    it('should remove tabs', () => {
      const query = 'query\t{\n\tuser\t{\n\t\tid\n\t}\n}';
      expect(normalizeQuery(query)).toBe('query{user{id}}');
    });

    it('should remove comments', () => {
      const query = 'query {\n  # This is a comment\n  user { id }\n}';
      expect(normalizeQuery(query)).toBe('query{user{id}}');
    });

    it('should convert to lowercase', () => {
      const query = 'QUERY { USER { ID } }';
      expect(normalizeQuery(query)).toBe('query{user{id}}');
    });

    it('should handle complex queries', () => {
      const query = `
        query GetUser($id: ID!) {
          # Fetch user by ID
          user(id: $id) {
            id
            name
            email
          }
        }
      `;
      expect(normalizeQuery(query)).toBe('querygetuser($id:id!){user(id:$id){idnameemail}}');
    });

    it('should handle empty string', () => {
      expect(normalizeQuery('')).toBe('');
    });
  });

  describe('isIntrospectionQuery', () => {
    it('should detect exact introspection query', () => {
      const query = FEDERATION_INTROSPECTION_QUERY;
      expect(isIntrospectionQuery(query)).toBe(true);
    });

    it('should detect introspection query with different whitespace', () => {
      const query = 'query SubgraphIntrospectQuery { _service { sdl } }';
      expect(isIntrospectionQuery(query)).toBe(true);
    });

    it('should detect introspection query with newlines', () => {
      const query = `
        query SubgraphIntrospectQuery {
          _service {
            sdl
          }
        }
      `;
      expect(isIntrospectionQuery(query)).toBe(true);
    });

    it('should detect introspection query without comments', () => {
      const query = 'query SubgraphIntrospectQuery { _service { sdl } }';
      expect(isIntrospectionQuery(query)).toBe(true);
    });

    it('should detect introspection query with different case', () => {
      const query = 'QUERY SUBGRAPHINTROSPECTQUERY { _SERVICE { SDL } }';
      expect(isIntrospectionQuery(query)).toBe(true);
    });

    it('should not detect regular queries', () => {
      const query = 'query { users { id name } }';
      expect(isIntrospectionQuery(query)).toBe(false);
    });

    it('should not detect partial matches', () => {
      const query = 'query { _service { sdl someOtherField } }';
      expect(isIntrospectionQuery(query)).toBe(false);
    });

    it('should not detect queries with different operation name', () => {
      const query = 'query SomeOtherQuery { _service { sdl } }';
      expect(isIntrospectionQuery(query)).toBe(false);
    });

    it('should handle empty string', () => {
      expect(isIntrospectionQuery('')).toBe(false);
    });

    it('should handle queries with extra whitespace and comments', () => {
      const query = `
        query   SubgraphIntrospectQuery   {
          # This fetches the SDL
          _service   {
            sdl
          }
        }
      `;
      expect(isIntrospectionQuery(query)).toBe(true);
    });
  });
});
