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
 * Payment routes record a payment the member already made.
 * Evidence is optional and is a different resource.
 */
@Controller('properties/:propertyId/payments')
export class PaymentsController {
  @Get()
  list() {
    return scaffoldList('payments');
  }

  @Post()
  create(): never {
    return scaffoldNotReady('payments');
  }

  @Get(':paymentId')
  getOne(): never {
    return scaffoldNotReady('payments');
  }

  @Patch(':paymentId')
  update(): never {
    return scaffoldNotReady('payments');
  }

  @Delete(':paymentId')
  remove(): never {
    return scaffoldNotReady('payments');
  }
}

@Module({
  controllers: [PaymentsController],
})
export class PaymentsModule {}
