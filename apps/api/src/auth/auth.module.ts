import { PrismaClient } from '@prisma/client';
import { Module } from '@nestjs/common';
import { AccessTokenGuard } from './access-token.guard.js';
import { loadAuthJwt } from './access-jwt.js';
import {
  ACCESS_TOKEN_VERIFIER,
  FailClosedAccessTokenVerifier,
} from './access-token.verifier.js';
import { AUTH_EMAIL, authEmailSenderFromEnv } from './auth-email.js';
import { AUTH_CODE_STORE, MemoryAuthCodes } from './auth-codes.js';
import { AuthController } from './auth.controller.js';
import { AuthService, MemoryAuthUsers } from './auth.service.js';
import { Es256AccessTokenVerifier } from './es256-access-token.verifier.js';
import { PrismaAuthAudit, PrismaAuthCodes, PrismaAuthSessions, PrismaAuthUsers } from './prisma-auth-store.js';
import { PrismaRefreshTokens } from './prisma-refresh-tokens.js';
import { AUTH_RATE, PrismaRateLimits } from './rate-limit.js';
import { serverSecret } from './server-secret.js';
import { FailClosedPropertyAccess, PROPERTY_ACCESS } from './property-access.js';
import { PropertyMembershipGuard } from './property-membership.guard.js';
import { AUTH_AUDIT, MemoryAuthAudit } from './auth-audit.js';
import {
  AUTH_CLOCK,
  AUTH_JWT,
  AUTH_LIMITS,
  AUTH_REFRESH,
  AUTH_USERS,
  SESSION_DIRECTORY,
  MemorySessionDirectory,
  authLimitsFromEnv,
  type SessionDirectory,
} from './session-directory.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AccessTokenGuard,
    PropertyMembershipGuard,
    {
      provide: SESSION_DIRECTORY,
      useFactory: () => {
        const db = authDatabase();
        return db ? new PrismaAuthSessions(db) : new MemorySessionDirectory();
      },
    },
    { provide: AUTH_EMAIL, useFactory: () => authEmailSenderFromEnv() },
    {
      provide: AUTH_CODE_STORE,
      useFactory: () => {
        const db = authDatabase();
        return db ? new PrismaAuthCodes(db) : new MemoryAuthCodes();
      },
    },
    {
      provide: AUTH_AUDIT,
      useFactory: () => {
        const db = authDatabase();
        return db ? new PrismaAuthAudit(db) : new MemoryAuthAudit();
      },
    },
    {
      provide: AUTH_USERS,
      useFactory: () => {
        const db = authDatabase();
        return db ? new PrismaAuthUsers(db) : new MemoryAuthUsers();
      },
    },
    {
      provide: AUTH_REFRESH,
      useFactory: () => {
        const db = authDatabase();
        return db ? new PrismaRefreshTokens(db, serverSecret()) : null;
      },
    },
    {
      provide: AUTH_RATE,
      useFactory: () => {
        const db = authDatabase();
        return db ? new PrismaRateLimits(db, serverSecret()) : null;
      },
    },
    { provide: AUTH_LIMITS, useFactory: () => authLimitsFromEnv() },
    { provide: AUTH_CLOCK, useValue: () => new Date() },
    { provide: AUTH_JWT, useFactory: () => loadAuthJwt()?.current ?? null },
    {
      provide: ACCESS_TOKEN_VERIFIER,
      useFactory: (sessions: SessionDirectory) => {
        const jwt = loadAuthJwt();
        if (!jwt) {
          return new FailClosedAccessTokenVerifier();
        }
        return new Es256AccessTokenVerifier(jwt, sessions);
      },
      inject: [SESSION_DIRECTORY],
    },
    { provide: PROPERTY_ACCESS, useClass: FailClosedPropertyAccess },
  ],
  exports: [
    AccessTokenGuard,
    PropertyMembershipGuard,
    ACCESS_TOKEN_VERIFIER,
    PROPERTY_ACCESS,
    AUTH_EMAIL,
    AUTH_CODE_STORE,
    SESSION_DIRECTORY,
  ],
})
export class AuthModule {}

let authPrisma: PrismaClient | undefined;

function authDatabase(): PrismaClient | null {
  if (process.env.NODE_ENV === 'test' || !process.env.DATABASE_URL) {
    return null;
  }
  authPrisma ??= new PrismaClient();
  return authPrisma;
}
