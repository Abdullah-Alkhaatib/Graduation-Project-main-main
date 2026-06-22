import { HealthCheckResponse } from "@workspace/api-zod";

/**
 * Get health check response
 */
export function getHealthCheck(): any {
  return HealthCheckResponse.parse({ status: "ok" });
}
