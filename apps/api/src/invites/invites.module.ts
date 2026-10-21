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
 * Email invites. Only an owner invites, by email, as member or viewer.
 * A token is single-use and expires 7 days after it is sent. A resend
 * restarts those 7 days. Accept is not property-scoped: the token identifies
 * the property. Accept checks, in order: unknown token or the wrong account
 * is 404 before any token state is revealed; used, revoked, superseded, or
 * expired is 410; an invitee who is already a member is 409. A non-owner
 * invite action is 403. Acceptance requires the invited email.
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
