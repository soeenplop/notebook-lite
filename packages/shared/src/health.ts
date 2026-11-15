import { z } from 'zod';

export const serviceNameSchema = z.enum(['api', 'worker']);
export type ServiceName = z.infer<typeof serviceNameSchema>;

/** Response body of the `/healthz` endpoints of api and worker. */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: serviceNameSchema,
  uptimeSeconds: z.number().nonnegative(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export function createHealthResponse(service: ServiceName, uptimeSeconds: number): HealthResponse {
  return healthResponseSchema.parse({ status: 'ok', service, uptimeSeconds });
}
