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
 * Evidence metadata and private object keys.
 * content-url stays unimplemented so this scaffold cannot return an object URL.
 */
@Controller('properties/:propertyId/evidence')
export class EvidenceController {
  @Get()
  list() {
    return scaffoldList('evidence');
  }

  @Post()
  create(): never {
    return scaffoldNotReady('evidence');
  }

  @Post('upload-url')
  uploadUrl(): never {
    return scaffoldNotReady('evidence');
  }

  @Post(':evidenceId/complete')
  complete(): never {
    return scaffoldNotReady('evidence');
  }

  @Get(':evidenceId')
  getOne(): never {
    return scaffoldNotReady('evidence');
  }

  @Get(':evidenceId/content-url')
  contentUrl(): never {
    return scaffoldNotReady('evidence');
  }

  @Delete(':evidenceId')
  remove(): never {
    return scaffoldNotReady('evidence');
  }
}

@Module({
  controllers: [EvidenceController],
})
export class EvidenceModule {}
