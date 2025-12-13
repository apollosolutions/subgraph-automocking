import { MockingProxyServer } from './server';
import { logger } from './middleware/requestLogger';
import { env } from './config/environment';

/**
 * Main application entry point
 *
 * Initializes and starts the mocking proxy server with proper error handling
 * and graceful shutdown support. Handles process signals (SIGTERM, SIGINT) for
 * clean container shutdown in Kubernetes environments.
 *
 * The entry point:
 * 1. Creates a server instance
 * 2. Registers signal handlers for graceful shutdown
 * 3. Starts the server
 * 4. Handles startup errors
 *
 * @example
 * ```bash
 * # Run the server
 * node dist/index.js
 *
 * # Or with ts-node in development
 * npx ts-node src/index.ts
 * ```
 */

let server: MockingProxyServer | null = null;
let isShuttingDown = false;

/**
 * Perform graceful shutdown
 *
 * Handles shutdown signals by stopping the server gracefully and
 * exiting the process with an appropriate exit code.
 *
 * @param {string} signal - Signal that triggered shutdown (e.g., 'SIGTERM', 'SIGINT')
 * @param {number} exitCode - Exit code to use (0 for normal, 1 for error)
 */
async function gracefulShutdown(signal: string, exitCode: number = 0): Promise<void> {
  // Prevent multiple shutdown attempts
  if (isShuttingDown) {
    logger.warn({ signal }, 'Shutdown already in progress, ignoring signal');
    return;
  }

  isShuttingDown = true;

  logger.info({ signal, exitCode }, 'Shutdown signal received');

  try {
    if (server) {
      // Stop server with 30 second timeout
      await server.stop(30000);
      logger.info('Server stopped successfully');
    }

    logger.info({ signal, exitCode }, 'Graceful shutdown complete');
    process.exit(exitCode);
  } catch (error) {
    logger.error({ err: error, signal }, 'Error during graceful shutdown');
    process.exit(1);
  }
}

/**
 * Handle uncaught exceptions
 *
 * Logs the error and triggers graceful shutdown to prevent the process
 * from continuing in an unknown state.
 *
 * @param {Error} error - Uncaught exception
 */
function handleUncaughtException(error: Error): void {
  logger.fatal({ err: error }, 'Uncaught exception, shutting down');

  // Trigger graceful shutdown with error exit code
  void gracefulShutdown('uncaughtException', 1);
}

/**
 * Handle unhandled promise rejections
 *
 * Logs the error and triggers graceful shutdown. These often indicate
 * programming errors that should be fixed.
 *
 * @param {unknown} reason - Rejection reason
 * @param {Promise<unknown>} promise - Promise that was rejected
 */
function handleUnhandledRejection(reason: unknown, promise: Promise<unknown>): void {
  logger.fatal(
    {
      err: reason,
      promise,
    },
    'Unhandled promise rejection, shutting down'
  );

  // Trigger graceful shutdown with error exit code
  void gracefulShutdown('unhandledRejection', 1);
}

/**
 * Main application function
 *
 * Initializes the server, sets up error handlers, and starts listening
 * for requests. This is the primary entry point for the application.
 */
async function main(): Promise<void> {
  try {
    logger.info({
      environment: env.NODE_ENV,
      port: env.PORT,
      logLevel: env.LOG_LEVEL,
      passthroughEnabled: env.ENABLE_PASSTHROUGH,
      mockOnError: env.MOCK_ON_ERROR,
    }, 'Starting mocking proxy server');

    // Create server instance
    // Note: Dependencies (handlers, registries) can be injected here
    server = new MockingProxyServer();

    // Register signal handlers for graceful shutdown
    process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM', 0); });
    process.on('SIGINT', () => { void gracefulShutdown('SIGINT', 0); });

    // Register error handlers
    process.on('uncaughtException', handleUncaughtException);
    process.on('unhandledRejection', handleUnhandledRejection);

    // Start server
    await server.start();

    logger.info('Mocking proxy server started successfully');
  } catch (error) {
    logger.fatal({ err: error }, 'Failed to start server');
    process.exit(1);
  }
}

// Start the application
main().catch((error) => {
  // This catch block handles errors thrown before error handlers are registered
  logger.fatal({ err: error }, 'Fatal error during startup');
  process.exit(1);
});

/**
 * Export server instance for testing
 *
 * Allows test files to access the server instance for integration testing
 * and graceful shutdown in test environments.
 */
export { server };
