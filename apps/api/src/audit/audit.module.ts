import { Controller, Get, Module } from '@nestjs/common';
import { scaffoldList } from '../common/scaffold.response.js';

@Controller('properties/:propertyId/audit-events')
export class AuditController {
  @Get()
  list() {
    return scaffoldList('audit');
  }
}

@Module({
  controllers: [AuditController],
})
export class AuditModule {}
