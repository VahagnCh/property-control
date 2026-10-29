import { Module } from '@nestjs/common';
import { AccessTokenGuard } from './access-token.guard.js';
import { loadAuthJwt } from './access-jwt.js';
import {
  ACCESS_TOKEN_VERIFIER,
  FailClosedAccessTokenVerifier,
} from './access-token.verifier.js';
import { AUTH_EMAIL, FakeAuthEmailSender } from './auth-email.js';
import { AUTH_CODE_STORE, MemoryAuthCodes } from './auth-codes.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { Es256AccessTokenVerifier } from './es256-access-token.verifier.js';
import { FailClosedPropertyAccess, PROPERTY_ACCESS } from './property-access.js';
import { PropertyMembershipGuard } from './property-membership.guard.js';
import { AUTH_CLOCK, AUTH_JWT, SESSION_DIRECTORY, SessionDirectory } from './session-directory.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AccessTokenGuard,
    PropertyMembershipGuard,
    SessionDirectory,
    { provide: SESSION_DIRECTORY, useExisting: SessionDirectory },
    { provide: AUTH_EMAIL, useClass: FakeAuthEmailSender },
    { provide: AUTH_CODE_STORE, useClass: MemoryAuthCodes },
    { provide: AUTH_CLOCK, useValue: () => new Date() },
    { provide: AUTH_JWT, useFactory: () => loadAuthJwt() },
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
