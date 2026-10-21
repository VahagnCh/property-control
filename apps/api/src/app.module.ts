import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { EvidenceModule } from './evidence/evidence.module.js';
import { HealthModule } from './health/health.module.js';
import { HomeModule } from './home/home.module.js';
import { InvitesModule } from './invites/invites.module.js';
import { MaintenanceModule } from './maintenance/maintenance.module.js';
import { MembershipsModule } from './memberships/memberships.module.js';
import { ObligationsModule } from './obligations/obligations.module.js';
import { OcrModule } from './ocr/ocr.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { PropertiesModule } from './properties/properties.module.js';
import { RemindersModule } from './reminders/reminders.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    HealthModule,
    AuthModule,
    UsersModule,
    HomeModule,
    PropertiesModule,
    MembershipsModule,
    InvitesModule,
    ObligationsModule,
    PaymentsModule,
    EvidenceModule,
    MaintenanceModule,
    DocumentsModule,
    RemindersModule,
    AuditModule,
    OcrModule,
  ],
})
export class AppModule {}
