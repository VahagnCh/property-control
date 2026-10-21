import { Module } from '@nestjs/common';
import { AccessTokenGuard } from './access-token.guard.js';
import {
  ACCESS_TOKEN_VERIFIER,
  FailClosedAccessTokenVerifier,
} from './access-token.verifier.js';
import { FailClosedPropertyAccess, PROPERTY_ACCESS } from './property-access.js';
import { PropertyMembershipGuard } from './property-membership.guard.js';

@Module({
  providers: [
    AccessTokenGuard,
    PropertyMembershipGuard,
    { provide: ACCESS_TOKEN_VERIFIER, useClass: FailClosedAccessTokenVerifier },
    { provide: PROPERTY_ACCESS, useClass: FailClosedPropertyAccess },
  ],
  exports: [AccessTokenGuard, PropertyMembershipGuard, ACCESS_TOKEN_VERIFIER, PROPERTY_ACCESS],
})
export class AuthModule {}
