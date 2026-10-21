import {
  Controller,
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
 * A correction is POST :paymentId/void. There is no DELETE.
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

  @Post(':paymentId/void')
  voidPayment(): never {
    return scaffoldNotReady('payments');
  }
}

@Module({
  controllers: [PaymentsController],
})
export class PaymentsModule {}
