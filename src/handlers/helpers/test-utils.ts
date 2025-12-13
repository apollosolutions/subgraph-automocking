import { Request, Response } from 'express';
import { vi } from 'vitest';

/**
 * Test utilities for handler testing
 */

/**
 * Create a mock Express Request object with optional overrides
 */
export function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    headers: {},
    method: 'POST',
    path: '/',
    url: '/',
    query: {},
    params: {},
    ...overrides,
  } as Request;
}

/**
 * Create a mock Express Response object with spies for all methods
 */
export function createMockResponse(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
    getHeader: vi.fn(),
    removeHeader: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
    locals: {},
  } as unknown as Response;

  return res;
}

/**
 * Create a valid GraphQL request body
 */
export function createGraphQLRequest(
  query: string,
  variables?: Record<string, any>,
  operationName?: string
): { query: string; variables?: Record<string, any>; operationName?: string } {
  return {
    query,
    ...(variables && { variables }),
    ...(operationName && { operationName }),
  };
}

/**
 * Common GraphQL query for testing
 */
export const SAMPLE_QUERY = `
  query GetProduct($id: ID!) {
    product(id: $id) {
      id
      name
      price
    }
  }
`;

/**
 * Sample GraphQL schema SDL
 */
export const SAMPLE_SCHEMA_SDL = `
  type Query {
    product(id: ID!): Product
    products: [Product!]!
  }

  type Product {
    id: ID!
    name: String!
    price: Float!
    description: String
  }
`;

/**
 * Wait for promises to resolve (useful for async testing)
 */
export async function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Assert that a response was sent with expected status and data
 */
export function assertResponseSent(
  res: Response,
  expectedStatus: number,
  expectedData?: any
): void {
  expect(res.status).toHaveBeenCalledWith(expectedStatus);
  if (expectedData !== undefined) {
    expect(res.json).toHaveBeenCalledWith(expectedData);
  }
}

/**
 * Assert that an error response was sent
 */
export function assertErrorResponse(
  res: Response,
  expectedStatus: number,
  expectedCode?: string
): void {
  expect(res.status).toHaveBeenCalledWith(expectedStatus);
  expect(res.json).toHaveBeenCalled();

  const jsonCall = (res.json as any).mock.calls[0][0];
  expect(jsonCall).toHaveProperty('errors');
  expect(Array.isArray(jsonCall.errors)).toBe(true);
  expect(jsonCall.errors.length).toBeGreaterThan(0);

  if (expectedCode) {
    expect(jsonCall.errors[0].extensions?.code).toBe(expectedCode);
  }
}

/**
 * Create mock headers with common defaults
 */
export function createMockHeaders(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    'content-type': 'application/json',
    'user-agent': 'test-agent',
    ...overrides,
  };
}
