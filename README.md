# Apollo Mocking Proxy

A GraphQL mocking proxy for Apollo Router development environments that provides intelligent request routing between real subgraphs and mock responses. Mocks are configurable with both global and per-subgraph options specified in the `config/mocks.js` file.

**The code in this repository is experimental and has been provided for reference purposes only. Community feedback is welcome but this project may not be supported in the same way that repositories in the official [Apollo GraphQL GitHub organization](https://github.com/apollographql) are. If you need help you can file an issue on this repository, [contact Apollo](https://www.apollographql.com/contact-sales) to talk to an expert, or create a ticket directly in Apollo Studio.**


## Features

- **Smart Request Routing**: Automatically routes requests to real subgraphs when available, falls back to mocks when unavailable or configured as such
- **Schema Caching**: Caches GraphQL schemas from Apollo Platform API with automatic refresh
- **Health Monitoring**: Health checking of subgraph availability with configurable intervals
- **Flexible Mocking Modes**: Support for forced, conditional, or disabled mocking per subgraph
- **Multiple Schema Sources**: Use schemas from local introspection, file, or GraphOS
- **Custom Mocks**: Support for custom mock resolvers per subgraph
- **Status Endpoint**: Real-time status of all subgraphs including mocking state and schema source

## Installation

This project uses yarn as its package manager. To install the dependencies of the mocking proxy:
```bash
yarn install
```

Copy the .env.example `cp .env.example .env` and set `APOLLO_KEY`, `APOLLO_GRAPH_ID`, and `APOLLO_GRAPH_VARIANT`

> You must use a key with at least the Contributor permission in GraphOS

For development with `rover dev`, add configuration to [router/config/supergraph.yaml](router/config/supergraph.yaml). See [here](https://www.apollographql.com/docs/rover/commands/supergraphs#yaml-configuration-file) for complete documentation of the supergraph configuration.

> When running `rover dev` with local introspection (file or url), you will need to duplicate the configuration in `config/subgraphs.js` to point at the same file or url to allow the mocking proxy to cache the same subgraph schema. A script could be built to construct the configuration if copying the config becomes burdensome. See the [example subgraph config](config/subgraphs.js.example) as a template.

### Yarn and vscode/cursor/windsurf
If you're having problems with IDEs not finding packages, please run:
```bash
yarn dlx @yarnpkg/sdks vscode
```

and update your workspace settings json with the following entries: 
```json
  "eslint.nodePath": ".yarn/sdks",
  "typescript.tsdk": ".yarn/sdks/typescript/lib",
```


## Usage
Once installed, you can start the proxy server with:
```bash
yarn start

# or in development mode
yarn dev
```

Then run the router in one of two ways:

### Router:dev

The `router:dev` command:

```bash
yarn router:dev
```

Starts the router using `rover dev`, introspecting the schema via a local file or a local endpoint which is proxied by the mocking proxy. Using `yarn router:dev` creates a temporary supergraph.yaml with introspection directed at the mocking proxy. `yarn router:dev` will also use a basic [router.yaml](router/config/router.yaml) with a rhai script configured.

For more information see the [README in router](router/README.md).

#### Dependencies
The underlying script requires python, yq, and rover. If any of those are not available to the command, it will inform you of how to find installation instructions.

### Router Binary

If you prefer to run the router via the binary, the mocking proxy will still work fine. You must provide the `APOLLO_KEY` and `APOLLO_GRAPH_REF` env variables as well as a router config yaml that at least includes a reference to the rhai script at [router/rhai/main.rhai](router/rhai/main.rhai).

Then run the router as usual and requests will be proxied through the proxy server:

```bash
APOLLO_GRAPH_REF=$APOLLO_GRAPH_ID@$APOLLO_GRAPH_VARIANT ./router -c config/router.yaml
```

## Known Limitations
1. There is duplicitive configuration required when running with local introspection and `rover dev`.
2. This tool is currently run as a proxy between the router and the subgraphs. The primitives are available to optionally run the tool as a coprocessor.

## Configuration

The mocking proxy automatically loads ALL available subgraphs from Apollo Registry on startup and allows you to override subgraphs with local configuration. This approach ensures complete supergraph coverage while enabling local development flexibility.

### Initialization Behavior

**Three-Phase Initialization:**

1. **Phase 1: Load from Apollo** - Fetches ALL available subgraphs from Apollo GraphOS for the configured supergraph
2. **Phase 2: Load Local Config** - Reads `config/subgraphs.js` (if present)
3. **Phase 3: Apply Overrides** - Overwrites Apollo config for matching subgraph names

**Example Scenario:**
- Apollo Registry has: `products`, `reviews`, `users`
- Local config overrides: `products` (to point to localhost)
- **Result**: All 3 subgraphs available, `products` uses local endpoint, others use endpoints defined in Apollo Registry

### Configuration File

Create a `config/subgraphs.js` file to override specific subgraphs. See [example config file](config/subgraphs.js.example)

```javascript
/**
 * @type {import('../src/config/subgraphConfig').SubgraphsConfig}
 */
export const config = {
  subgraphs: {
    products: {
      url: process.env.PRODUCTS_URL || 'http://localhost:4001/graphql',
      forceMock: false,
      disableMocking: false,
      useLocalSchema: true,
      maxRetries: 2,
      retryDelayMs: 1000,
      healthCheckIntervalMs: 30000,
    },
    reviews: {
      url: process.env.REVIEWS_URL,
      forceMock: true,
      useLocalSchema: false,
      maxRetries: 2,
      retryDelayMs: 1000,
      healthCheckIntervalMs: 30000,
    },
  },
};
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | string | - | Local GraphQL subgraph server endpoint for introspection and passthrough (e.g., `http://localhost:4001/graphql`) |
| `schemaFile` | string | - | Local GraphQL subgraph schema file (e.g., `subgraph.graphql`) |
| `forceMock` | boolean | `false` | Always mock responses regardless of subgraph availability |
| `disableMocking` | boolean | `false` | Never mock responses, fail if subgraph unavailable |
| `useLocalSchema` | boolean | `false` | Use local introspection vs Apollo Registry for schema source |
| `introspectionHeaders` | object | - | Custom headers to include with introspection queries (e.g., `{ 'authorization': 'Bearer token' }`) |
| `maxRetries` | number | `2` | Number of retry attempts for health checks (0-10) |
| `retryDelayMs` | number | `1000` | Delay between retry attempts in milliseconds (100-30000) |
| `healthCheckIntervalMs` | number | `30000` | Interval between periodic health checks in milliseconds (5000-300000) |

**Note:** `forceMock` and `disableMocking` cannot both be `true`.

### Routing Behavior

**All subgraphs are loaded from Apollo Registry by default.** Local configuration overrides specific subgraphs. **All subgraphs get automatic health monitoring** using defaults if no config provided.

The proxy uses the following logic to determine request routing:

| Scenario | forceMock | disableMocking | Health Status | Schema Source | Request Handling |
|----------|-----------|----------------|---------------|---------------|------------------|
| 1 | `true` | `false` | Any | Apollo or Local | Always mock (ignores health) |
| 2 | `false` | `true` | Any | Apollo or Local | Always pass through, fail if unavailable |
| 3 | `false` | `false` | Healthy | Apollo or Local | Pass through to subgraph |
| 4 | `false` | `false` | Unhealthy (>maxRetries) | Apollo or Local | Start mocking |
| 5 | `false` | `false` | Recovered | Apollo or Local | Stop mocking, resume pass through |


### Schema Sources

The proxy supports two schema sources:

#### 1. Local Introspection (`useLocalSchema: true`)

- Introspects GraphQL schema directly from subgraph's URL or from a graphql schema file
- **Precedence:** A local file takes precedence over an introspection url. If the introspection url is set but not available, the schema registry will use the remote schema if available.
- Automatic retry logic with configurable attempts
- 10-second timeout for introspection queries
- **Best for:** Local development with running subgraphs

#### 2. Apollo Registry (`useLocalSchema: false` - default)

- Fetches schema from Apollo GraphOS Platform API
- Requires `APOLLO_KEY` and `APOLLO_GRAPH_REF` environment variables
- Allows for complete local mocking based on the schema from GraphOS for quick startup or debugging router configs
- **Best for:** Production-like testing or UI development when subgraphs not running locally

### Monitoring Subgraph Health

**All subgraphs get automatic health monitoring** with default configuration. The proxy monitors subgraph health through periodic health checks:

1. **Initial Registration**: Subgraph registered with optimistic `isHealthy: true`
2. **Immediate First Check**: Performs health check on startup
3. **Periodic Checks**: Runs health checks at configured interval (default: 30s) against main URL
4. **Failure Tracking**: Increments `consecutiveFailures` counter on each failed check
5. **Mocking Transition**: Switches to mocking after `maxRetries` consecutive failures (unless `disableMocking: true`)
6. **Recovery**: Resets failure counter and stops mocking when subgraph becomes available again


You can monitor subgraph health in real-time via the `/status` endpoint or check logs for health status updates.

### Custom Introspection Headers

When using local schema introspection (`useLocalSchema: true`), you may need to include custom headers for authentication or other purposes (ala the router's introspectionHeaders object). The `introspectionHeaders` configuration option allows you to specify headers that will be sent with introspection queries.

**Common use cases:**
- **Authentication**: Send bearer tokens or API keys for protected endpoints
- **Custom routing**: Include headers required by API gateways or load balancers

**Example configuration:**

```javascript
export const config = {
  subgraphs: {
    products: {
      url: process.env.PRODUCTS_URL,
      useLocalSchema: true,
      introspectionHeaders: {
        'authorization': `Bearer ${process.env.PRODUCTS_TOKEN}`,
        'x-api-key': process.env.PRODUCTS_API_KEY,
        'x-environment': 'development',
      },
    },
  },
};
```

**Important notes:**
- Headers are only used for introspection queries, not for regular GraphQL requests
- The `Content-Type` header defaults to `application/json` but can be overridden in case that's required
- Headers are passed on all retry attempts if introspection fails
- Empty or undefined header values are included as-is (use environment variable defaults carefully)

## Custom Mocks Configuration

The proxy supports custom mock data through a centralized mocking system that allows you to define global mock resolvers shared across all subgraphs, while also providing the ability to override specific types for individual subgraphs.

### Why Use Custom Mocks?

Custom mocks give you fine-grained control over mock data generation:

- **Consistent Test Data**: Define global mocks that apply across all subgraphs for consistent behavior
- **Realistic Responses**: Generate domain-specific data that matches your production schemas
- **Override Flexibility**: Customize mocks per subgraph when needed while inheriting global defaults

### Mocks File Structure

Create a `mocks/mocks.js` file with the following structure. See [full example](config/mocks.js.example)

```javascript
// mocks/mocks.js
export const mocks = {
  // Global mocks apply to all subgraphs
  _globals: {
    // Scalar type overrides
    String: () => 'Global String Value',
    Int: () => 42,
    Float: () => 3.14,
    Boolean: () => true,
    ID: () => 'global-id-123',

    // Custom scalar types
    DateTime: () => '2024-01-15T10:30:00Z',
    Email: () => 'user@example.com',
    URL: () => 'https://example.com',

    // Common type mocks
    User: () => ({
      id: () => 'user-global-001',
      email: () => 'globaluser@example.com',
      name: () => 'Global User',
      createdAt: () => new Date().toISOString(),
    }),

    // Query type (applies to all subgraphs)
    Query: () => ({
      __typename: () => 'Query',
    }),
  },

  // Subgraph-specific mocks override global mocks
  products: {
    // Override Int specifically for products subgraph
    Int: () => 100,

    // Product-specific type mocks
    Product: () => ({
      id: () => 'prod-001',
      name: () => 'Sample Product',
      price: () => 29.99,
      inStock: () => true,
      description: () => 'A sample product for testing',
    }),

    // Override Query for products
    Query: () => ({
      product: (parent, args) => ({
        id: () => args.id || 'default-id',
        name: () => `Product ${args.id}`,
        price: () => 99.99,
      }),
      products: () => [
        { id: 'prod-1', name: 'Product 1', price: 10.99 },
        { id: 'prod-2', name: 'Product 2', price: 20.99 },
      ],
    }),
  },

  reviews: {
    // Reviews subgraph inherits global String, Int, User, etc.
    // but defines its own Review type
    Review: () => ({
      id: () => `review-${Date.now()}`,
      rating: () => Math.floor(Math.random() * 5) + 1,
      title: () => 'Sample Review',
      comment: () => 'This is a test review',
      helpful: () => Math.floor(Math.random() * 100),
      createdAt: () => new Date().toISOString(),
    }),
  },
};
```

### Global Mocks (_globals)

Global mocks are defined under the special `_globals` property and apply to **all subgraphs** by default. This is useful for:

1. **Consistent Scalar Types**: Define standard representations for scalars like `String`, `Int`, `DateTime` across all subgraphs
2. **Shared Entity Types**: Mock common types (e.g., `User`, `Error`) that appear in multiple subgraphs
3. **Base Query/Mutation Types**: Provide default implementations for query and mutation types
4. **Custom Scalars**: Define organization-wide custom scalar implementations


### Subgraph-Specific Mocks

Subgraph-specific mocks are defined as top-level properties (matching subgraph names) and **override** global mocks for that specific subgraph only.

**Key Principles:**

1. **Name Matching**: The property name must match the exact subgraph name (e.g., `products`, `reviews`, `users`)
2. **Selective Override**: Only override types you need to customize; all other types inherit from `_globals`
3. **Complete Replacement**: When you override a type, you replace it completely (no merging with global definition)
4. **Precedence**: Subgraph-specific mocks always take precedence over global mocks


### Precedence Rules

The mock resolution follows a clear precedence hierarchy:

1. **Subgraph-Specific Mocks** (Highest Priority)
   - Defined under the subgraph name (e.g., `products`, `reviews`)
   - Completely overrides global mocks for that type
   - Only applies to the specific subgraph

2. **Global Mocks** (_globals)
   - Defined under the `_globals` property
   - Applies to all subgraphs
   - Used when subgraph doesn't define a specific override

3. **Default Mock Generators** (Lowest Priority)
   - Built-in default generators from `@graphql-tools/mock`
   - Used when neither subgraph-specific nor global mocks are defined
   - Generates random data based on GraphQL type


### Troubleshooting

**Mock not applying:**
- Verify subgraph name matches exactly (case-sensitive)
- Check that the file is in the correct location (`mocks/mocks.js`)
- Ensure the module exports an object with proper structure
- Check server logs for mock loading errors

**Type mismatch errors:**
- Ensure mock resolvers return functions, not direct values
- Verify nested object structure matches GraphQL schema
- Check that field resolvers return appropriate types

## GraphQL Code Generator

This project uses GraphQL Code Generator to create TypeScript types for Apollo Studio API queries, ensuring type-safe interactions with the Apollo Platform API.

### Quick Start

1. **Set your Apollo API key:**
   ```bash
   export APOLLO_KEY="service:your-graph:your-api-key"
   ```
   
   Or add to `.env`:
   ```
   APOLLO_KEY=service:your-graph:your-api-key
   ```

2. **Generate types:**
   ```bash
   yarn codegen
   ```

3. **Watch mode (auto-regenerate on changes):**
   ```bash
   yarn codegen:watch
   ```

### Files

- **`src/graphql/operations.graphql`** - GraphQL operations (queries/mutations)
- **`codegen.ts`** - Code generator configuration
- **`src/generated/graphql.ts`** - Generated TypeScript types (auto-generated, do not edit)

### Usage in Code

After running codegen, import the generated types and operations:

```typescript
import { GetSubgraphSchemaDocument, GetSubgraphSchemaQuery } from '../generated/graphql';
import { ApolloClient } from '@apollo/client/core';

const client = new ApolloClient({...});

// Type-safe query with auto-completion
const result = await client.query<GetSubgraphSchemaQuery>({
  query: GetSubgraphSchemaDocument,
  variables: {
    graphId: 'my-graph',
    variant: 'current',
    subgraphName: 'products',
  },
});

// result.data is fully typed!
console.log(result.data.graph?.variant?.subgraph?.activePartialSchema?.sdl);
```

### Adding New Operations

1. Add your GraphQL operation to `src/graphql/operations.graphql`
2. Run `yarn codegen` to generate types
3. Import and use the generated types in your code

### Schema Source

The schema is fetched from Apollo Studio API:
- **URL:** `https://api.apollographql.com/api/graphql`
- **Auth:** Requires `x-api-key` header with your Apollo API key

### Configuration

See `codegen.ts` for configuration options. Key settings:

- **Plugins:** typescript, typescript-operations, typed-document-node
- **Naming:** PascalCase for types, UPPER_CASE for enums
- **Strict scalars:** Enabled for type safety
- **Auto-format:** Runs prettier after generation

# Endpoints

## Root Health Check

Simple health check endpoint that returns basic service information.

**Endpoint:**
```bash
GET http://localhost:3000/
```

**Response:**
```json
{
  "service": "mocking-proxy",
  "status": "running",
  "version": "1.0.0",
  "timestamp": "2025-01-24T12:00:00.000Z"
}
```

**Status Codes:**
- `200 OK` - Service is running

**Use Case:** Quick verification that the service is alive and responding.

---

## Liveness Probe

Kubernetes liveness probe endpoint that checks if the server is running and should not be restarted.

**Endpoint:**
```bash
GET http://localhost:3000/live
```

**Response:**
```json
{
  "status": "alive",
  "timestamp": "2025-01-24T12:00:00.000Z",
  "uptime": 3600
}
```

**Status Codes:**
- `200 OK` - Server is alive

**Use Case:** Kubernetes liveness probes. Should only fail if the service is in an unrecoverable state that requires a restart.

---

## Readiness Probe

Kubernetes readiness probe endpoint that checks if the server is ready to accept traffic.

**Endpoint:**
```bash
GET http://localhost:3000/ready
```

**Response (Ready):**
```json
{
  "status": "ready",
  "timestamp": "2025-01-24T12:00:00.000Z"
}
```

**Response (Not Ready):**
```json
{
  "status": "not_ready",
  "timestamp": "2025-01-24T12:00:00.000Z"
}
```

**Status Codes:**
- `200 OK` - Server is ready to accept traffic
- `503 Service Unavailable` - Server is not ready (e.g., during startup or when dependencies are unavailable)

**Use Case:** Kubernetes readiness probes. Tells the load balancer whether to route traffic to this instance.

---

## Detailed Health Check

Comprehensive health check endpoint with component-level status information.

**Endpoint:**
```bash
GET http://localhost:3000/health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-01-24T12:00:00.000Z",
  "uptime": 3600,
  "checks": {
    "server": {
      "status": "healthy",
      "message": "Server is running",
      "lastCheck": "2025-01-24T12:00:00.000Z",
      "metrics": {
        "port": 3000,
        "environment": "development",
        "uptime": 3600
      }
    },
    "subgraphRegistry": {
      "status": "degraded",
      "message": "1/2 subgraphs available",
      "lastCheck": "2025-01-24T12:00:00.000Z",
      "metrics": {
        "totalSubgraphs": 2,
        "healthySubgraphs": 1,
        "unhealthySubgraphs": 1
      }
    },
    "schemaCache": {
      "status": "healthy",
      "message": "Schema cache active",
      "lastCheck": "2025-01-24T12:00:00.000Z",
      "metrics": {
        "cacheEnabled": true,
        "ttlMs": 300000
      }
    }
  }
}
```

**Status Codes:**
- `200 OK` - Service is healthy or degraded
- `503 Service Unavailable` - Service is unhealthy

**Health Status Values:**
- `healthy` - All components operating normally
- `degraded` - Service functional but some components have issues
- `unhealthy` - Service has critical issues

**Use Case:** Monitoring dashboards, detailed health status for operations teams.

---

## Subgraph Status

Returns detailed real-time information about all registered subgraphs, including health status, mocking state, and configuration.

**Endpoint:**
```bash
GET http://localhost:3000/status
```

**Response:**
```json
{
  "timestamp": "2025-01-24T12:00:00.000Z",
  "totalSubgraphs": 2,
  "healthySubgraphs": 1,
  "mockingSubgraphs": 1,
  "subgraphs": [
    {
      "name": "products",
      "url": "http://products:4001/graphql",
      "status": "available",
      "isHealthy": true,
      "isMocking": false,
      "schemaSource": "local-introspection",
      "lastCheck": "2025-01-24T11:59:30.000Z",
      "consecutiveFailures": 0,
      "config": {
        "forceMock": false,
        "disableMocking": false,
        "useLocalSchema": true,
        "maxRetries": 3
      }
    },
    {
      "name": "reviews",
      "url": "http://reviews:4002/graphql",
      "status": "mocking",
      "isHealthy": false,
      "isMocking": true,
      "schemaSource": "apollo-registry",
      "lastCheck": "2025-01-24T11:59:30.000Z",
      "consecutiveFailures": 0,
      "config": {
        "forceMock": true,
        "disableMocking": false,
        "useLocalSchema": false,
        "maxRetries": 3
      }
    }
  ]
}
```

**Status Codes:**
- `200 OK` - Successfully retrieved status

**Response Fields:**
- `timestamp` - Current server timestamp
- `totalSubgraphs` - Total number of registered subgraphs
- `healthySubgraphs` - Number of healthy/available subgraphs
- `mockingSubgraphs` - Number of subgraphs currently being mocked
- `subgraphs[]` - Array of subgraph information objects
  - `name` - Subgraph name
  - `url` - Subgraph URL (if configured)
  - `status` - Current status: `"available"`, `"mocking"`, or `"unavailable"`
  - `isHealthy` - Boolean indicating if subgraph is passing health checks
  - `isMocking` - Boolean indicating if requests are being mocked
  - `schemaSource` - Where the schema was loaded from: `"local-introspection"`, `"local-file"`, or `"apollo-registry"`
  - `lastCheck` - Timestamp of last health check
  - `consecutiveFailures` - Number of consecutive failed health checks
  - `config` - Configuration options for this subgraph

**Use Case:** Monitoring subgraph health, debugging routing decisions, verifying configuration.

---

## GraphQL Proxy

Main proxy endpoint that handles GraphQL requests with intelligent routing between real subgraphs and mock responses.

**Endpoint:**
```bash
POST http://localhost:3000/:encodedUrl
```

**URL Parameters:**
- `encodedUrl` - URL-encoded target subgraph URL (e.g., `http%3A%2F%2Fproducts%3A4001%2Fgraphql`)

**Headers:**
- `x-subgraph-name` (required) - Name of the target subgraph (e.g., `products`, `reviews`)
- `Content-Type: application/json` - GraphQL request body format
- Additional headers are forwarded to real subgraph (when passthrough mode is active)

**Request Body:**
```json
{
  "query": "query GetProduct($id: ID!) { product(id: $id) { id name price } }",
  "variables": {
    "id": "prod-123"
  },
  "operationName": "GetProduct"
}
```

**Response (Passthrough - Real Subgraph):**
```json
{
  "data": {
    "product": {
      "id": "prod-123",
      "name": "Real Product from Database",
      "price": 29.99
    }
  }
}
```

**Response (Mock):**
```json
{
  "data": {
    "product": {
      "id": "prod-123",
      "name": "Sample Product",
      "price": 99.99
    }
  }
}
```

**Response (Error - Schema Not Found):**
```json
{
  "errors": [
    {
      "message": "Schema not found for subgraph: unknown-service",
      "extensions": {
        "code": "SCHEMA_NOT_FOUND",
        "subgraphName": "unknown-service"
      }
    }
  ]
}
```

**Status Codes:**
- `200 OK` - GraphQL request processed (check response for GraphQL errors)
- `404 Not Found` - Subgraph schema not found
- `500 Internal Server Error` - Server error during processing
- `503 Service Unavailable` - Subgraph unavailable and mocking disabled


**Example Usage:**

```bash
# Encode the target URL
TARGET_URL="http://products:4001/graphql"
ENCODED_URL=$(echo -n "$TARGET_URL" | jq -sRr @uri)

# Make GraphQL request
curl -X POST "http://localhost:3000/$ENCODED_URL" \
  -H "Content-Type: application/json" \
  -H "x-subgraph-name: products" \
  -d '{
    "query": "{ products { id name price } }"
  }'
```

**Use Case:** Primary endpoint for Apollo Router to proxy GraphQL requests to subgraphs with automatic mocking fallback.

## Development

```bash
# Start development server with hot reload
yarn dev

# Start the router with updated endpoints for introspection
yarn router:dev
```

## Testing

The project includes both unit tests and integration tests to ensure reliability.

### Unit Tests
Run the full test suite:
```bash
yarn test
```

### Integration Tests
Integration tests run against the local express instance to verify the proxy's behavior, including routing, mocking, and error handling.
```bash
yarn test:integration
```

### Code Coverage
```bash
yarn test:coverage
open coverage/index.html
```