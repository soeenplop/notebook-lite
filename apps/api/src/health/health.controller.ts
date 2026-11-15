import { Controller, Get } from '@nestjs/common';
import { createHealthResponse, type HealthResponse } from '@notebook-lite/shared';

@Controller('healthz')
export class HealthController {
  @Get()
  check(): HealthResponse {
    return createHealthResponse('api', process.uptime());
  }
}
