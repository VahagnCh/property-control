import {
  Controller,
  Delete,
  Get,
  Module,
  Patch,
  Post,
} from '@nestjs/common';
import {
  scaffoldList,
  scaffoldNotReady,
} from '../common/scaffold.response.js';

@Controller('properties/:propertyId/maintenance-tasks')
export class MaintenanceController {
  @Get()
  list() {
    return scaffoldList('maintenance');
  }

  @Post()
  create(): never {
    return scaffoldNotReady('maintenance');
  }

  @Get(':taskId')
  getOne(): never {
    return scaffoldNotReady('maintenance');
  }

  @Patch(':taskId')
  update(): never {
    return scaffoldNotReady('maintenance');
  }

  @Delete(':taskId')
  remove(): never {
    return scaffoldNotReady('maintenance');
  }
}

@Module({
  controllers: [MaintenanceController],
})
export class MaintenanceModule {}
