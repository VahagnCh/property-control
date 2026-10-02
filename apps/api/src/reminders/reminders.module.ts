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

@Controller('properties/:propertyId/reminders')
export class RemindersController {
  @Get()
  list() {
    return scaffoldList('reminders');
  }

  @Post()
  create(): never {
    return scaffoldNotReady('reminders');
  }

  @Patch(':reminderId')
  update(): never {
    return scaffoldNotReady('reminders');
  }

  @Delete(':reminderId')
  remove(): never {
    return scaffoldNotReady('reminders');
  }
}

@Module({
  controllers: [RemindersController],
})
export class RemindersModule {}
