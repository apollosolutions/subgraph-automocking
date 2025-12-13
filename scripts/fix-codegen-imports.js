#!/usr/bin/env node

/**
 * Post-codegen script to fix imports in generated GraphQL types
 * 
 * This script replaces the import from '@graphql-typed-document-node/core'
 * with '@apollo/client' to ensure compatibility with our Apollo Client setup.
 */

const fs = require('fs');
const path = require('path');

const GENERATED_FILE = path.join(__dirname, '../src/generated/graphql.ts');

try {
  // Read the generated file
  let content = fs.readFileSync(GENERATED_FILE, 'utf8');
  
  // Replace the import
  const originalImport = "import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';";
  const newImport = "import type { TypedDocumentNode as DocumentNode } from '@apollo/client';";
  
  if (content.includes(originalImport)) {
    content = content.replace(originalImport, newImport);
    
    // Write back to file
    fs.writeFileSync(GENERATED_FILE, content, 'utf8');
    
    console.log('✓ Fixed import in generated graphql.ts');
  } else {
    console.log('ℹ No import replacement needed');
  }
} catch (error) {
  console.error('Error fixing imports:', error.message);
  process.exit(1);
}
