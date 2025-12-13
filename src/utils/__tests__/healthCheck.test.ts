import { describe, it, expect, vi } from 'vitest';
import { Request } from 'express';
import {
  HealthStatus,
  createHealthCheckResponse,
  aggregateHealth,
  createComponentHealth,
  healthCheckHandler,
  detailedHealthCheckHandler,
  readinessCheckHandler,
  livenessCheckHandler,
  getUptime,
} from '../../../src/utils/healthCheck';

/**
 * Health Check Utilities Tests
 *
 * Tests health check response generation and handlers.
 */

function createMockReq(query: Record<string, string> = {}): Partial<Request> {
  return {
    query,
    log: {
      debug: vi.fn(),
      info: vi.fn(),
    } as any,
  };
}

function createMockRes(): any {
  const res: any = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res;
}

describe('Health Check Utilities', () => {
  describe('HealthStatus enum', () => {
    it('should have correct status values', () => {
      expect(HealthStatus.HEALTHY).toBe('healthy');
      expect(HealthStatus.DEGRADED).toBe('degraded');
      expect(HealthStatus.UNHEALTHY).toBe('unhealthy');
    });
  });

  describe('getUptime', () => {
    it('should return uptime in seconds', () => {
      const uptime = getUptime();
      expect(typeof uptime).toBe('number');
      expect(uptime).toBeGreaterThanOrEqual(0);
    });

    it('should increase over time', async () => {
      const uptime1 = getUptime();
      await new Promise(resolve => setTimeout(resolve, 1100)); // Wait >1 second to ensure different value
      const uptime2 = getUptime();
      expect(uptime2).toBeGreaterThanOrEqual(uptime1 + 1);
    });
  });

  describe('createHealthCheckResponse', () => {
    it('should create basic healthy response', () => {
      const response = createHealthCheckResponse(HealthStatus.HEALTHY);

      expect(response.status).toBe(HealthStatus.HEALTHY);
      expect(response.timestamp).toBeDefined();
      expect(typeof response.uptime).toBe('number');
      expect(response.version).toBeUndefined();
      expect(response.checks).toBeUndefined();
    });

    it('should include version when provided', () => {
      const response = createHealthCheckResponse(HealthStatus.HEALTHY, {
        version: '1.0.0',
      });

      expect(response.version).toBe('1.0.0');
    });

    it('should include metrics when requested', () => {
      const response = createHealthCheckResponse(HealthStatus.HEALTHY, {
        includeMetrics: true,
      });

      expect(response.metadata).toBeDefined();
      expect(response.metadata?.environment).toBeDefined();
      expect(response.metadata?.hostname).toBeDefined();
    });

    it('should create degraded response', () => {
      const response = createHealthCheckResponse(HealthStatus.DEGRADED);
      expect(response.status).toBe(HealthStatus.DEGRADED);
    });

    it('should create unhealthy response', () => {
      const response = createHealthCheckResponse(HealthStatus.UNHEALTHY);
      expect(response.status).toBe(HealthStatus.UNHEALTHY);
    });

    it('should use current timestamp', () => {
      const before = new Date().toISOString();
      const response = createHealthCheckResponse(HealthStatus.HEALTHY);
      const after = new Date().toISOString();

      expect(response.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(response.timestamp >= before).toBe(true);
      expect(response.timestamp <= after).toBe(true);
    });
  });

  describe('createComponentHealth', () => {
    it('should create component health with status only', () => {
      const health = createComponentHealth(HealthStatus.HEALTHY);

      expect(health.status).toBe(HealthStatus.HEALTHY);
      expect(health.message).toBeUndefined();
      expect(health.lastCheck).toBeDefined();
      expect(health.metrics).toBeUndefined();
    });

    it('should create component health with message', () => {
      const health = createComponentHealth(
        HealthStatus.HEALTHY,
        'Database connected'
      );

      expect(health.status).toBe(HealthStatus.HEALTHY);
      expect(health.message).toBe('Database connected');
    });

    it('should create component health with metrics', () => {
      const health = createComponentHealth(
        HealthStatus.HEALTHY,
        'Cache active',
        { hitRate: 0.95, size: 1000 }
      );

      expect(health.metrics).toEqual({ hitRate: 0.95, size: 1000 });
    });

    it('should include timestamp in lastCheck', () => {
      const before = new Date().toISOString();
      const health = createComponentHealth(HealthStatus.HEALTHY);
      const after = new Date().toISOString();

      expect(health.lastCheck).toBeDefined();
      expect(health.lastCheck! >= before).toBe(true);
      expect(health.lastCheck! <= after).toBe(true);
    });
  });

  describe('aggregateHealth', () => {
    it('should return healthy when all components are healthy', () => {
      const checks = {
        database: createComponentHealth(HealthStatus.HEALTHY),
        cache: createComponentHealth(HealthStatus.HEALTHY),
        api: createComponentHealth(HealthStatus.HEALTHY),
      };

      expect(aggregateHealth(checks)).toBe(HealthStatus.HEALTHY);
    });

    it('should return degraded when any component is degraded', () => {
      const checks = {
        database: createComponentHealth(HealthStatus.HEALTHY),
        cache: createComponentHealth(HealthStatus.DEGRADED),
        api: createComponentHealth(HealthStatus.HEALTHY),
      };

      expect(aggregateHealth(checks)).toBe(HealthStatus.DEGRADED);
    });

    it('should return unhealthy when any component is unhealthy', () => {
      const checks = {
        database: createComponentHealth(HealthStatus.UNHEALTHY),
        cache: createComponentHealth(HealthStatus.HEALTHY),
      };

      expect(aggregateHealth(checks)).toBe(HealthStatus.UNHEALTHY);
    });

    it('should prioritize unhealthy over degraded', () => {
      const checks = {
        database: createComponentHealth(HealthStatus.UNHEALTHY),
        cache: createComponentHealth(HealthStatus.DEGRADED),
        api: createComponentHealth(HealthStatus.HEALTHY),
      };

      expect(aggregateHealth(checks)).toBe(HealthStatus.UNHEALTHY);
    });

    it('should return healthy for empty checks object', () => {
      expect(aggregateHealth({})).toBe(HealthStatus.HEALTHY);
    });
  });

  describe('healthCheckHandler', () => {
    it('should return 200 with basic health info', () => {
      const req = createMockReq() as Request;
      const res = createMockRes();

      healthCheckHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalled();

      const response = res.json.mock.calls[0][0];
      expect(response.status).toBe(HealthStatus.HEALTHY);
      expect(response.timestamp).toBeDefined();
      expect(response.uptime).toBeDefined();
    });

    it('should include metrics when requested via query param', () => {
      const req = createMockReq({ metrics: 'true' }) as Request;
      const res = createMockRes();

      healthCheckHandler(req, res);

      const response = res.json.mock.calls[0][0];
      expect(response.metadata).toBeDefined();
    });

    it('should not include metrics by default', () => {
      const req = createMockReq() as Request;
      const res = createMockRes();

      healthCheckHandler(req, res);

      const response = res.json.mock.calls[0][0];
      expect(response.metadata).toBeUndefined();
    });
  });

  describe('detailedHealthCheckHandler', () => {
    it('should return healthy status when all checks pass', async () => {
      const getChecks = vi.fn().mockReturnValue({
        database: createComponentHealth(HealthStatus.HEALTHY),
        cache: createComponentHealth(HealthStatus.HEALTHY),
      });

      const handler = detailedHealthCheckHandler(getChecks);
      const req = createMockReq() as Request;
      const res = createMockRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const response = res.json.mock.calls[0][0];
      expect(response.status).toBe(HealthStatus.HEALTHY);
      expect(response.checks).toBeDefined();
      expect(getChecks).toHaveBeenCalled();
    });

    it('should return degraded status when any check is degraded', async () => {
      const getChecks = vi.fn().mockReturnValue({
        database: createComponentHealth(HealthStatus.HEALTHY),
        cache: createComponentHealth(HealthStatus.DEGRADED),
      });

      const handler = detailedHealthCheckHandler(getChecks);
      const req = createMockReq() as Request;
      const res = createMockRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200); // Still return 200 for degraded
      const response = res.json.mock.calls[0][0];
      expect(response.status).toBe(HealthStatus.DEGRADED);
    });

    it('should return 503 when unhealthy', async () => {
      const getChecks = vi.fn().mockReturnValue({
        database: createComponentHealth(HealthStatus.UNHEALTHY),
      });

      const handler = detailedHealthCheckHandler(getChecks);
      const req = createMockReq() as Request;
      const res = createMockRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      const response = res.json.mock.calls[0][0];
      expect(response.status).toBe(HealthStatus.UNHEALTHY);
    });

    it('should handle async getChecks function', async () => {
      const getChecks = vi.fn().mockResolvedValue({
        database: createComponentHealth(HealthStatus.HEALTHY),
      });

      const handler = detailedHealthCheckHandler(getChecks);
      const req = createMockReq() as Request;
      const res = createMockRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(getChecks).toHaveBeenCalled();
    });

    it('should return 503 if getChecks throws error', async () => {
      const getChecks = vi.fn().mockRejectedValue(new Error('Check failed'));

      const handler = detailedHealthCheckHandler(getChecks);
      const req = createMockReq() as Request;
      const res = createMockRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      const response = res.json.mock.calls[0][0];
      expect(response.status).toBe(HealthStatus.UNHEALTHY);
    });
  });

  describe('readinessCheckHandler', () => {
    it('should return 200 when service is ready', async () => {
      const isReady = vi.fn().mockReturnValue(true);
      const handler = readinessCheckHandler(isReady);
      const req = createMockReq() as Request;
      const res = createMockRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const response = res.json.mock.calls[0][0];
      expect(response.status).toBe('ready');
      expect(isReady).toHaveBeenCalled();
    });

    it('should return 503 when service is not ready', async () => {
      const isReady = vi.fn().mockReturnValue(false);
      const handler = readinessCheckHandler(isReady);
      const req = createMockReq() as Request;
      const res = createMockRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      const response = res.json.mock.calls[0][0];
      expect(response.status).toBe('not_ready');
    });

    it('should handle async isReady function', async () => {
      const isReady = vi.fn().mockResolvedValue(true);
      const handler = readinessCheckHandler(isReady);
      const req = createMockReq() as Request;
      const res = createMockRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(isReady).toHaveBeenCalled();
    });

    it('should return 503 if isReady throws error', async () => {
      const isReady = vi.fn().mockRejectedValue(new Error('Readiness check failed'));
      const handler = readinessCheckHandler(isReady);
      const req = createMockReq() as Request;
      const res = createMockRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      const response = res.json.mock.calls[0][0];
      expect(response.status).toBe('not_ready');
      expect(response.error).toBeDefined();
    });
  });

  describe('livenessCheckHandler', () => {
    it('should always return 200', () => {
      const handler = livenessCheckHandler();
      const req = createMockReq() as Request;
      const res = createMockRes();

      handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const response = res.json.mock.calls[0][0];
      expect(response.status).toBe('alive');
      expect(response.timestamp).toBeDefined();
      expect(response.uptime).toBeDefined();
    });

    it('should include uptime in response', () => {
      const handler = livenessCheckHandler();
      const req = createMockReq() as Request;
      const res = createMockRes();

      handler(req, res);

      const response = res.json.mock.calls[0][0];
      expect(typeof response.uptime).toBe('number');
      expect(response.uptime).toBeGreaterThanOrEqual(0);
    });
  });
});
