#!/usr/bin/env bash
# Router Runner Helper
#
# This script helps run Apollo Router with the mocking proxy by:
# 1. Copying the supergraph config to a temporary location
# 2. Updating subgraph URLs to route through the mocking proxy
# 3. Starting the router with `rover dev`
#
# Usage:
#   ./run-with-proxy.sh [options]
#
# Options:
#   --supergraph-config <path>  Path to original supergraph config (default: config/supergraph.yaml)
#   --router-config <path>      Path to router config (default: config/router.yaml)
#   --proxy-host <url>          Mocking proxy host (default: $SUBGRAPH_PROXY_HOST or http://localhost:3000)
#   --interval <seconds>        Router polling interval (default: 10)
#   --log <level>              Log level (default: info)

set -e  # Exit on error

# Default values
SUPERGRAPH_CONFIG="${SUPERGRAPH_CONFIG:-config/supergraph.yaml}"
ROUTER_CONFIG="${ROUTER_CONFIG:-config/router.yaml}"
PROXY_HOST="${SUBGRAPH_PROXY_HOST:-http://localhost:3000}"
INTERVAL="${INTERVAL:-30}"
LOG_LEVEL="${LOG_LEVEL:-info}"
TEMP_CONFIG=""

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --supergraph-config)
      SUPERGRAPH_CONFIG="$2"
      shift 2
      ;;
    --router-config)
      ROUTER_CONFIG="$2"
      shift 2
      ;;
    --proxy-host)
      PROXY_HOST="$2"
      shift 2
      ;;
    --interval)
      INTERVAL="$2"
      shift 2
      ;;
    --log)
      LOG_LEVEL="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# URL encode function using Python (most portable)
urlencode() {
  python3 -c "import urllib.parse; print(urllib.parse.quote('''$1''', safe=''))"
}

# Check for required commands
command -v yq >/dev/null 2>&1 || {
  echo "Error: yq is required but not installed."
  echo "Install with: brew install yq (macOS) or see https://github.com/mikefarah/yq"
  exit 1
}

command -v rover >/dev/null 2>&1 || {
  echo "Error: rover is required but not installed."
  echo "Install from: https://www.apollographql.com/docs/rover/getting-started"
  exit 1
}

# Cleanup function
cleanup() {
  if [[ -n "$TEMP_CONFIG" && -f "$TEMP_CONFIG" ]]; then
    rm -f "$TEMP_CONFIG"
    echo ""
    echo "[INFO] Cleaned up temporary config: $TEMP_CONFIG"
  fi
}

# Set trap for cleanup on exit
trap cleanup EXIT INT TERM

# Print configuration
echo "[INFO] Router Runner Helper"
echo "[INFO] Supergraph config: $SUPERGRAPH_CONFIG"
echo "[INFO] Router config: $ROUTER_CONFIG"
echo "[INFO] Proxy host: $PROXY_HOST"
echo ""

# Check if supergraph config exists
if [[ ! -f "$SUPERGRAPH_CONFIG" ]]; then
  echo "Error: Supergraph config not found: $SUPERGRAPH_CONFIG"
  exit 1
fi

# Create temporary config file
TEMP_CONFIG="$(dirname "$SUPERGRAPH_CONFIG")/.supergraph.proxy-$(date +%s).yaml"

# Copy original config to temp
cp "$SUPERGRAPH_CONFIG" "$TEMP_CONFIG"

# Get list of subgraphs
SUBGRAPHS=$(yq eval '.subgraphs | keys | .[]' "$SUPERGRAPH_CONFIG")

# Process each subgraph
for subgraph in $SUBGRAPHS; do
  # Check if subgraph uses file-based schema
  HAS_FILE=$(yq eval ".subgraphs.$subgraph.schema.file" "$SUPERGRAPH_CONFIG")
  if [[ "$HAS_FILE" != "null" ]]; then
    echo "[INFO] Skipping $subgraph (uses file-based schema)"
    continue
  fi

  # Get subgraph URL
  SUBGRAPH_URL=$(yq eval ".subgraphs.$subgraph.schema.subgraph_url" "$SUPERGRAPH_CONFIG")

  if [[ "$SUBGRAPH_URL" == "null" || -z "$SUBGRAPH_URL" ]]; then
    echo "[INFO] Skipping $subgraph (no subgraph_url)"
    continue
  fi

  # URL encode the subgraph URL
  ENCODED_URL=$(urlencode "$SUBGRAPH_URL")
  PROXY_URL="${PROXY_HOST}/${ENCODED_URL}"

  echo "[INFO] Updating $subgraph:"
  echo "  Original: $SUBGRAPH_URL"
  echo "  Proxy:    $PROXY_URL"

  # Update the subgraph URL in temp config
  yq eval -i ".subgraphs.$subgraph.schema.subgraph_url = \"$PROXY_URL\"" "$TEMP_CONFIG"

  # Add x-subgraph-name header
  yq eval -i ".subgraphs.$subgraph.schema.introspection_headers.\"x-subgraph-name\" = \"$subgraph\"" "$TEMP_CONFIG"
done

echo ""
echo "[INFO] Temporary config written to: $TEMP_CONFIG"
echo ""

# Start router
echo "[INFO] Starting router: rover dev --router-config $ROUTER_CONFIG --supergraph-config $TEMP_CONFIG -i $INTERVAL --log $LOG_LEVEL"
echo ""

rover dev \
  --router-config "$ROUTER_CONFIG" \
  --supergraph-config "$TEMP_CONFIG" \
  -i "$INTERVAL" \
  --log "$LOG_LEVEL"
