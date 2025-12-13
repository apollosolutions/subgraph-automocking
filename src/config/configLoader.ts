import { promises as fs } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { validateSubgraphConfig, SubgraphsConfig } from './subgraphConfig';
import { logger } from '../middleware/requestLogger';

/**
 * Configuration file path
 */
const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'config', 'subgraphs.js');

/**
 * Loads and validates subgraph configuration from JavaScript file
 *
 * @param configPath - Path to configuration file (default: ./config/subgraphs.js)
 * @returns Validated subgraph configuration
 * @throws Error if file doesn't exist, is invalid JavaScript, or fails validation
 *
 * @example
 * ```typescript
 * const config = await loadSubgraphConfig();
 * console.log(config.subgraphs.products.forceMock);
 * ```
 */
export async function loadSubgraphConfig(
  configPath: string = DEFAULT_CONFIG_PATH
): Promise<SubgraphsConfig> {
  try {
    // Check if file exists
    await fs.access(configPath);

    // Convert file path to file URL for dynamic import
    const fileUrl = pathToFileURL(configPath).href;

    // Dynamically import the configuration file
    // Add cache-busting query parameter to ensure fresh import in tests
    const configModule = await import(`${fileUrl}?update=${Date.now()}`) as unknown;

    // Extract config from the module (supports both default and named exports)
    // We will validate the config against the schema so not too concerned about the type of the config yet
    const module = configModule as Record<'config' | 'default', unknown>;
    const rawConfig: unknown = module?.config ?? module?.default;

    if (!rawConfig) {
      throw new Error('Configuration file must export a "config" object or default export');
    }

    // Validate against schema
    const validatedConfig = validateSubgraphConfig(rawConfig);

    logger.info({
      configPath,
      count: Object.keys(validatedConfig.subgraphs).length
    }, '[ConfigLoader] Successfully loaded configuration');

    return validatedConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.warn({ configPath }, '[ConfigLoader] Configuration file not found, using empty configuration');
      return { subgraphs: {} };
    }

    // Zod validation error
    if (error instanceof Error && 'issues' in error) {
      logger.error({ error }, '[ConfigLoader] Configuration validation failed');
      throw new Error(`Configuration validation failed: ${error.message}`);
    }

    logger.error({ error }, '[ConfigLoader] Failed to load configuration');
    throw error;
  }
}
