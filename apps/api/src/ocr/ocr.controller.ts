import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { OcrService } from './ocr.service.js';
import type { OcrDecision } from './ocr.types.js';

@Controller('properties/:propertyId')
export class OcrController {
  constructor(@Inject(OcrService) private readonly ocr: OcrService) {}

  @Post('documents/:documentId/ocr-jobs')
  create(
    @Param('propertyId') propertyId: string,
    @Param('documentId') documentId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = this.ocr.enqueue(propertyId, documentId);
    res.status(result.created ? 201 : 200);
    return result.job;
  }

  @Get('documents/:documentId/ocr-jobs')
  list(
    @Param('propertyId') propertyId: string,
    @Param('documentId') documentId: string,
  ) {
    return { items: this.ocr.listForDocument(propertyId, documentId) };
  }

  @Get('ocr-jobs/:ocrJobId')
  getOne(
    @Param('propertyId') propertyId: string,
    @Param('ocrJobId') ocrJobId: string,
  ) {
    return this.ocr.getJob(propertyId, ocrJobId);
  }

  @Post('ocr-jobs/:ocrJobId/confirm')
  @HttpCode(200)
  confirm(
    @Param('propertyId') propertyId: string,
    @Param('ocrJobId') ocrJobId: string,
    @Body() body: { decisions?: OcrDecision[] },
  ) {
    return this.ocr.confirm(propertyId, ocrJobId, body?.decisions ?? []);
  }
}
