import { Controller, Get, Module } from '@nestjs/common';
import { scaffoldList } from '../common/scaffold.response.js';

@Controller('home')
export class HomeController {
  @Get('action-items')
  actionItems() {
    return scaffoldList('home');
  }
}

@Module({
  controllers: [HomeController],
})
export class HomeModule {}
