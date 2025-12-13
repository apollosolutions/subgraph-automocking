# Generated GraphQL Types

This directory contains auto-generated TypeScript types from GraphQL operations.

**DO NOT EDIT THESE FILES MANUALLY**

## Regenerating Types

To regenerate the types after modifying GraphQL operations:

```bash
# One-time generation
yarn codegen

# Watch mode (regenerates on file changes)
yarn codegen:watch
```

## Authentication

The codegen process requires an Apollo API key to fetch the schema:

```bash
APOLLO_KEY=your-api-key-here yarn codegen
```

Or set it in your `.env` file:

```
APOLLO_KEY=service:your-graph:your-api-key
```
