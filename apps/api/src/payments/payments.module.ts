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
 * amount on the wire is WireMoney: a decimal string such as "1234.50"
 * plus currency MXN, never a float. The database stores integer centavos.
 * The one-year paidAt back-date limit uses the property timezone, not UTC.
 * A viewer write, such as void, is 403. A non-member or unknown payment is 404.
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
