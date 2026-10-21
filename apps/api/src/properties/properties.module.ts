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
 * Property JSON uses PropertyResponse. timezone is an IANA string on every
 * response and defaults to America/Mexico_City when the write body omits it.
 */
@Controller('properties')
export class PropertiesController {
  @Get()
  list() {
    return scaffoldList('properties');
  }

  @Post()
  create(): never {
    return scaffoldNotReady('properties');
  }

  @Get(':propertyId')
  getOne(): never {
    return scaffoldNotReady('properties');
  }

  @Patch(':propertyId')
  update(): never {
    return scaffoldNotReady('properties');
  }

  @Delete(':propertyId')
  remove(): never {
    return scaffoldNotReady('properties');
  }
}

@Module({
  controllers: [PropertiesController],
})
export class PropertiesModule {}
