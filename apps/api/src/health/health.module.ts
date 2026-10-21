import { Module } from '@nestjs/common';
import {
  HEALTH_LIMITER,
  HEALTH_PROBE,
  LiveHealthController,
  PrismaHealthProbe,
} from './live-health.controller.js';
import { HealthRateLimiter } from './live-health.js';

@Module({
  controllers: [LiveHealthController],
  providers: [
    { provide: HEALTH_PROBE, useClass: PrismaHealthProbe },
    { provide: HEALTH_LIMITER, useClass: HealthRateLimiter },
  ],
})
export class HealthModule {}
