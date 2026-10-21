import { Controller, Get, Module } from '@nestjs/common';
import { scaffoldNotReady } from '../common/scaffold.response.js';

@Controller('me')
export class MeController {
  @Get()
  me(): never {
    return scaffoldNotReady('users');
  }
}

@Module({
  controllers: [MeController],
})
export class UsersModule {}
