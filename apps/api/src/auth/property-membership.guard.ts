import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { isTraversal, isUuid, pathOnly } from '../common/path-safety.js';
import { OCR_ERROR, ocrBadRequest, ocrForbidden, ocrNotFound, ocrUnauthorized } from '../ocr/ocr-errors.js';
import { PROPERTY_ACCESS, type MembershipRole, type PropertyAccess } from './property-access.js';

interface RequestWithAuth {
  headers: Record<string, string | string[] | undefined>;
  params?: Record<string, unknown>;
  method?: string;
  originalUrl?: string;
  url?: string;
  accessToken?: { sub: string };
  membership?: { role: MembershipRole; userId: string };
}

@Injectable()
export class PropertyMembershipGuard implements CanActivate {
  constructor(@Inject(PROPERTY_ACCESS) private readonly access: PropertyAccess) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const userId = request.accessToken?.sub;
    if (!userId) {
      throw ocrUnauthorized(OCR_ERROR.tokenMissing, 'Missing access token.');
    }

    const params = request.params ?? {};
    const url = pathOnly(request.originalUrl ?? request.url ?? '');
    if (isTraversal(url)) {
      throw ocrBadRequest(OCR_ERROR.invalidPath, 'Invalid path parameter.');
    }
    for (const [name, value] of Object.entries(params)) {
      if (!name.endsWith('Id')) {
        continue;
      }
      if (typeof value !== 'string' || !isUuid(value) || isTraversal(value)) {
        throw ocrBadRequest(OCR_ERROR.invalidPath, 'Invalid path parameter.');
      }
    }

    const propertyId = params.propertyId;
    if (typeof propertyId !== 'string') {
      throw ocrBadRequest(OCR_ERROR.invalidPath, 'Invalid path parameter.');
    }

    const membership = this.access.resolve({ userId, propertyId });
    if (!membership || membership.userId !== userId || !isRole(membership.role)) {
      throw ocrNotFound();
    }

    const documentId = params.documentId;
    if (typeof documentId === 'string' && !this.access.documentBelongsToProperty(propertyId, documentId)) {
      throw ocrNotFound();
    }

    const method = request.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD' && membership.role === 'viewer') {
      throw ocrForbidden('Insufficient role.');
    }

    request.membership = { role: membership.role, userId };
    return true;
  }
}

function isRole(role: string): role is MembershipRole {
  return role === 'owner' || role === 'member' || role === 'viewer';
}
