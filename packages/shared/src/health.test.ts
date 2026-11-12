import { describe, expect, it } from 'vitest';
import { createHealthResponse, healthResponseSchema } from './health.js';

describe('createHealthResponse', () => {
  it('builds a valid health response', () => {
    const res = createHealthResponse('api', 12.5);
    expect(res).toEqual({ status: 'ok', service: 'api', uptimeSeconds: 12.5 });
    expect(healthResponseSchema.safeParse(res).success).toBe(true);
  });

  it('rejects negative uptime', () => {
    expect(() => createHealthResponse('worker', -1)).toThrow(/>=0/);
  });
});
