import { Module } from '@nestjs/common';
import { OcrController } from './ocr.controller.js';
import { OcrService } from './ocr.service.js';

@Module({
  controllers: [OcrController],
  providers: [OcrService],
})
export class OcrModule {}
