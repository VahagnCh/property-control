import { Controller, Get, Module } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  getHealth(): { status: 'ok'; service: string } {
    return { status: 'ok', service: 'property-control-api' };
  }
}

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
