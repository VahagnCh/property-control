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

@Controller('properties/:propertyId/obligations')
export class ObligationsController {
  @Get()
  list() {
    return scaffoldList('obligations');
  }

  @Post()
  create(): never {
    return scaffoldNotReady('obligations');
  }

  @Get(':obligationId')
  getOne(): never {
    return scaffoldNotReady('obligations');
  }

  @Patch(':obligationId')
  update(): never {
    return scaffoldNotReady('obligations');
  }

  @Delete(':obligationId')
  remove(): never {
    return scaffoldNotReady('obligations');
  }

  @Post(':obligationId/resume')
  resume(): never {
    return scaffoldNotReady('obligations');
  }

  @Post(':obligationId/unarchive')
  unarchive(): never {
    return scaffoldNotReady('obligations');
  }

  @Get(':obligationId/period-outcomes')
  listPeriodOutcomes() {
    return scaffoldList('obligation-period-outcomes');
  }

  @Post(':obligationId/period-outcomes')
  markPeriod(): never {
    return scaffoldNotReady('obligation-period-outcomes');
  }
}

@Module({
  controllers: [ObligationsController],
})
export class ObligationsModule {}
