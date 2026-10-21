import { Controller, Get, Module } from '@nestjs/common';
import {
  HEALTH_LIMITER,
  HEALTH_PROBE,
  LiveHealthController,
  PrismaHealthProbe,
} from './live-health.controller.js';
import { HealthRateLimiter } from './live-health.js';

@Controller('health')
export class HealthController {
  @Get()
  getHealth(): { status: 'ok'; service: string } {
    return { status: 'ok', service: 'property-control-api' };
  }
}

@Module({
  controllers: [HealthController, LiveHealthController],
  providers: [
    { provide: HEALTH_PROBE, useClass: PrismaHealthProbe },
    { provide: HEALTH_LIMITER, useClass: HealthRateLimiter },
  ],
})
export class HealthModule {}
