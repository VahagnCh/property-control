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

@Controller('properties/:propertyId/memberships')
export class MembershipsController {
  @Get()
  list() {
    return scaffoldList('memberships');
  }

  @Post()
  create(): never {
    return scaffoldNotReady('memberships');
  }

  @Patch(':membershipId')
  update(): never {
    return scaffoldNotReady('memberships');
  }

  @Delete(':membershipId')
  remove(): never {
    return scaffoldNotReady('memberships');
  }
}

@Module({
  controllers: [MembershipsController],
})
export class MembershipsModule {}
