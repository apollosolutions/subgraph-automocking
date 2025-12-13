# Apollo Router Configuration for Mocking Proxy

This directory contains Apollo Router configurations and Rhai scripts for enabling the mocking proxy in development environments.

## Directory Structure

```
src/router/
├── config/
│   ├── router.yaml         # Configuration for the router
├── rhai/
│   └── main.rhai           # Rhai script for URL rewriting
└── README.md               # This file
```

## Overview

The Apollo Router can be configured to route subgraph requests through the mocking proxy server for local development. This enables developers to:

- **Work offline**: Use mocked responses when subgraphs are unavailable
- **Isolated testing**: Test specific subgraphs without running entire stack
- **Faster iteration**: Avoid waiting for slow/flaky subgraph dependencies

## How It Works

### URL Rewriting Flow

1. **Router receives request** for a subgraph query
2. **Rhai script** intercepts the request at the subgraph service layer
3. **URL rewriting** encodes the original subgraph URL:
   - Original: `http://users-service:4001/graphql`
   - Rewritten: `http://localhost:3000/http%3A%2F%2Fusers-service%3A4001%2Fgraphql`
4. **Proxy server** receives the request, decodes the URL, and either:
   - **Passthrough mode**: Forwards to live subgraph (if available)
   - **Mocking mode**: Returns mock response using cached schema (if unavailable)

### Configuration Files

#### router.yaml
A simple router configuration meant for use with `rover dev`.
This configuration provides the router with the rhai script details and should be further customized as needed

#### supergraph.yaml
A simple supergraph configuration meant for use with `rover dev`.
When using the mocking proxy, set the subgraph_url to the proxy URL with the encoded subgraph URL appended.

For example, if the subgraph is running at http://localhost:4001 and the proxy is running at http://localhost:3000:
> NOTE: url encoding the subgraph_url is only required when NOT running with the `run-with-proxy.sh` helper

```yaml
subgraphs:
  users:
    # route requests to the subgraph here
    routing_url: http://localhost:4001
    schema:
      # route schema introspection requests to the proxy by appending the encoded subgraph URL
      subgraph_url: http://localhost:3000/http%3A%2F%2Flocalhost%3A4001
      # include the subgraph name in the request
      introspection_headers:
        x-subgraph-name: users
```

## Usage

### Option 1: Using the Router Runner Helper (Recommended)

The router runner helper automatically configures your supergraph to route through the mocking proxy:

```bash
# export your .env file
set -a; source .env; set +a

# Start the mocking proxy first
yarn dev

# In another terminal, run the router with the helper script
set -a; source .env; set +a
yarn router:dev

# Or run directly from the router directory
cd src/router
./run-with-proxy.sh
```

#### What the Runner Does

The `run-with-proxy.sh` script:

1. **Reads your supergraph config** - Takes the original supergraph.yaml configuration
2. **Creates a temporary copy** - Generates a temporary config file (`.supergraph.proxy-<timestamp>.yaml`)
3. **Updates subgraph URLs** - Transforms each subgraph URL to route through the proxy:
   ```yaml
   # Original
   subgraph_url: http://localhost:4001

   # Updated
   subgraph_url: ${SUBGRAPH_PROXY_HOST}/http%3A%2F%2Flocalhost%3A4001
   introspection_headers:
     x-subgraph-name: products
   ```
4. **Starts the router** - Runs `rover dev` with the updated configuration
5. **Cleanup on exit** - Automatically removes the temporary file when the router stops

#### Configuration Options

```bash
./run-with-proxy.sh \
  --supergraph-config config/supergraph.yaml \  # Original config file
  --router-config config/router.yaml \          # Router config file
  --proxy-host http://localhost:3000 \          # Proxy server URL
  --interval 10 \                               # Polling interval (seconds)
  --log info                                    # Log level
```

**Requirements**:
- `yq` - YAML processor (install: `brew install yq` on macOS)
- `rover` - Apollo Rover CLI
- `python3` - For URL encoding (pre-installed on most systems)

**Note**: Subgraphs using `file` for their schema will be skipped (not routed through proxy).

### Option 2: Manual Configuration

If you prefer to manually configure your supergraph.yaml for the proxy:

```bash
# export your .env file
set -a; source .env; set +a

# Start the mocking proxy first
yarn dev

# In another terminal, start the router with development config
set -a; source .env; set +a
cd src/router
rover dev \
  --router-config config/router.yaml \
  --supergraph-config config/supergraph.yaml \
  --log info
```

### Environment Variables

| Variable | Default | Description |
|----------|------------|-------------|
| `SUBGRAPH_PROXY_ENABLED` | `false` | Enable/disable mocking proxy |
| `SUBGRAPH_PROXY_HOST` | `http://localhost:3000` | Mocking proxy address |