import axios, { AxiosError } from "axios";
import { logger } from "../middleware/requestLogger";
import { FEDERATION_INTROSPECTION_QUERY, IntrospectionQueryResult } from "../utils/queryUtils";

/**
 * Result of an introspection attempt
 */
export interface IntrospectionResult {
  success: boolean;
  sdl?: string;
  error?: string;
  duration: number;
}

/**
 * Retry configuration for introspection
 */
export interface RetryConfig {
  maxRetries: number;
  retryDelayMs: number;
}

/**
 * Service for introspecting GraphQL schemas from local endpoints
 *
 * Handles introspection with configurable retry logic and timeout handling.
 *
 * @example
 * ```typescript
 * const service = new IntrospectionService();
 * const result = await service.introspect('http://localhost:4001/graphql', {
 *   maxRetries: 3,
 *   retryDelayMs: 1000
 * });
 *
 * if (result.success) {
 *   console.log('Schema introspected successfully');
 * }
 * ```
 */
export class IntrospectionService {
  private static readonly INTROSPECTION_TIMEOUT_MS = 10000;

  /**
   * Introspects a GraphQL schema from a local endpoint
   *
   * @param endpoint - GraphQL endpoint URL
   * @param retryConfig - Retry configuration
   * @param customHeaders - Optional custom headers to include in introspection request
   * @returns Introspection result with schema or error
   */
  public async introspect(
    endpoint: string,
    retryConfig: RetryConfig = { maxRetries: 3, retryDelayMs: 1000 },
    customHeaders?: Record<string, string>
  ): Promise<IntrospectionResult> {
    const startTime = Date.now();

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      try {
        logger.info(
          {
            endpoint,
            attempt: attempt + 1,
            totalAttempts: retryConfig.maxRetries + 1,
          },
          "[IntrospectionService] Introspecting endpoint"
        );

        const sdl = await this.performIntrospection(endpoint, customHeaders);
        const duration = Date.now() - startTime;

        logger.info(
          { endpoint, duration },
          "[IntrospectionService] Successfully introspected endpoint"
        );

        return {
          success: true,
          sdl,
          duration,
        };
      } catch (error) {
        const isLastAttempt = attempt === retryConfig.maxRetries;

        if (isLastAttempt) {
          const duration = Date.now() - startTime;
          const errorMessage = this.getErrorMessage(error);

          logger.error(
            { endpoint, attempts: attempt + 1, errorMessage },
            "[IntrospectionService] Failed to introspect endpoint after all attempts"
          );

          return {
            success: false,
            error: errorMessage,
            duration,
          };
        }

        // Wait before retrying
        logger.warn(
          { retryDelayMs: retryConfig.retryDelayMs },
          "[IntrospectionService] Introspection failed, retrying"
        );
        await this.delay(retryConfig.retryDelayMs);
      }
    }

    // This should never be reached due to the loop logic above
    const duration = Date.now() - startTime;
    return {
      success: false,
      error: "Introspection failed after all retries",
      duration,
    };
  }

  /**
   * Performs a single introspection attempt
   *
   * @param endpoint - GraphQL endpoint URL
   * @param customHeaders - Optional custom headers to include in request
   * @returns GraphQL SDL string
   */
  private async performIntrospection(
    endpoint: string,
    customHeaders?: Record<string, string>
  ): Promise<string> {
    const response = await axios.post<IntrospectionQueryResult>(
      endpoint,
      {
        query: FEDERATION_INTROSPECTION_QUERY,
      },
      {
        timeout: IntrospectionService.INTROSPECTION_TIMEOUT_MS,
        headers: {
          "Content-Type": "application/json",
          ...customHeaders, // Merge custom headers, allowing overrides
        },
      }
    );

    if (!response.data?.data) {
      logger.error({ response }, "Invalid introspection response: missing data");
      throw new Error("Invalid introspection response: missing data");
    }

    return response.data.data._service.sdl;
  }

  /**
   * Extracts error message from various error types
   *
   * @param error - Error object
   * @returns Error message string
   */
  private getErrorMessage(error: unknown): string {
    // Check for AxiosError (both instanceof and isAxiosError flag for mock compatibility)
    const isAxiosError = this.isAxiosError(error);

    if (isAxiosError) {
      if (error.code === "ECONNREFUSED") {
        return `Connection refused - endpoint may not be running`;
      }
      if (
        error.code === "ETIMEDOUT" ||
        error.code === "ECONNABORTED"
      ) {
        return `Request timeout after ${IntrospectionService.INTROSPECTION_TIMEOUT_MS}ms`;
      }
      if (error.response) {
        return `HTTP ${error.response.status}: ${error.response.statusText}`;
      }
      return error.message;
    }

    if (error instanceof Error) {
      return error.message;
    }

    return "Unknown error";
  }

  private isAxiosError(error: unknown): error is AxiosError {
    return (
      error instanceof AxiosError ||
      (error != null &&
        typeof error === "object" &&
        "isAxiosError" in error &&
        error.isAxiosError === true)
    );
  }

  /**
   * Delays execution for specified milliseconds
   *
   * @param ms - Milliseconds to delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
