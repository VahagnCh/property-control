import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CLOCK, SystemClock } from './clock.js';
import { OCR_EXTRACTOR, StubOcrExtractor } from './ocr-extractor.js';
import { OcrEnabledGuard } from './ocr-enabled.guard.js';
import { OCR_RUNTIME, loadOcrRuntime } from './ocr-runtime.js';
import { FailClosedOcrTargetLookup, OCR_TARGET_LOOKUP } from './ocr-target-lookup.js';
import { OcrController } from './ocr.controller.js';
import { OcrService } from './ocr.service.js';
import { OBJECT_STORAGE, PrivateObjectStorage } from './object-storage.js';
import { RequestGuardMiddleware } from './request-guard.middleware.js';

@Module({
  imports: [AuthModule],
  controllers: [OcrController],
  providers: [
    OcrService,
    OcrEnabledGuard,
    RequestGuardMiddleware,
    { provide: OCR_RUNTIME, useFactory: () => loadOcrRuntime() },
    { provide: OCR_TARGET_LOOKUP, useClass: FailClosedOcrTargetLookup },
    { provide: CLOCK, useClass: SystemClock },
    { provide: OCR_EXTRACTOR, useClass: StubOcrExtractor },
    { provide: OBJECT_STORAGE, useClass: PrivateObjectStorage },
  ],
})
export class OcrModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestGuardMiddleware).forRoutes('{*path}');
  }
}
