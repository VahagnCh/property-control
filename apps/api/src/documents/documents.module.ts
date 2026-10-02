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

/**
 * Document bytes stay in private storage. content-url is not implemented,
 * so this scaffold cannot return an object URL.
 */
@Controller('properties/:propertyId/documents')
export class DocumentsController {
  @Get()
  list() {
    return scaffoldList('documents');
  }

  @Post()
  create(): never {
    return scaffoldNotReady('documents');
  }

  @Get(':documentId')
  getOne(): never {
    return scaffoldNotReady('documents');
  }

  @Get(':documentId/content-url')
  contentUrl(): never {
    return scaffoldNotReady('documents');
  }

  @Patch(':documentId')
  update(): never {
    return scaffoldNotReady('documents');
  }

  @Delete(':documentId')
  remove(): never {
    return scaffoldNotReady('documents');
  }
}

@Module({
  controllers: [DocumentsController],
})
export class DocumentsModule {}
