import {
  Controller,
  Delete,
  Get,
  Module,
  Post,
} from '@nestjs/common';
import {
  scaffoldList,
  scaffoldNotReady,
} from '../common/scaffold.response.js';

/**
 * Email invites. A token is single-use and expires 7 days after it is sent.
 * Accept is not property-scoped: the token identifies the property.
 */
@Controller('properties/:propertyId/invites')
export class InvitesController {
  @Get()
  list() {
    return scaffoldList('invites');
  }

  @Post()
  create(): never {
    return scaffoldNotReady('invites');
  }

  @Post(':inviteId/resend')
  resend(): never {
    return scaffoldNotReady('invites');
  }

  @Delete(':inviteId')
  revoke(): never {
    return scaffoldNotReady('invites');
  }
}

@Controller('invites')
export class InviteAcceptController {
  @Post('accept')
  accept(): never {
    return scaffoldNotReady('invites');
  }
}

@Module({
  controllers: [InvitesController, InviteAcceptController],
})
export class InvitesModule {}
