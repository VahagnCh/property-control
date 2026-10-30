import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import { assertIdempotencyKey, IdempotencyKeyInvalidException, IdempotencyKeyReusedException, type IdempotencyStore } from '../auth/idempotency-keys.js';
import { notFoundException } from '../common/not-found.js';
import { stripOneTrailingSlash } from '../common/path-safety.js';
import { OCR_ERROR, ocrUnauthorized } from '../ocr/ocr-errors.js';
import { assertNextDueDateInRange } from '../obligations/next-due-date.js';
import { redactedTextState, sealAuditText } from '../ocr/audit-text.js';
import type { OcrConfirmAudit } from '../ocr/ocr.types.js';
import { assertPaidAt } from '../payments/paid-at.js';
import { recordPayment, voidPayment as voidLedgerPayment } from '../payments/ledger.js';
import { centavosToLedgerNumber, centavosToWireAmount } from '../payments/wire-money.js';
import { ledgerTx } from '../persistence/prisma-ledger.js';
import {
  OCCUPANCY_STATUSES,
  PROPERTY_TYPES,
  assertWritablePropertyTimezone,
  toPropertyResponse,
  type OccupancyStatus,
  type PropertyType,
} from '../properties/property.response.js';
import { parsePositiveCentavos } from './money.js';
import { runIdempotent, type IdempotentResult } from './run-idempotent.js';
import { assertNotes, assertSingleLine } from './text.js';

const CATEGORIES = [
  'predial',
  'water',
  'electricity',
  'gas',
  'internet',
  'mantenimiento',
  'mortgage',
  'insurance',
  'security',
  'other',
] as const;

const CADENCES = [
  'monthly',
  'bimonthly',
  'quarterly',
  'semiannual',
  'annual',
  'custom',
  'irregular',
] as const;

const SCHEDULED = new Set(['monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual']);

type Category = (typeof CATEGORIES)[number];
type Cadence = (typeof CADENCES)[number];

interface PropertyInput {
  name?: string;
  propertyType: PropertyType;
  occupancyStatus: OccupancyStatus | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  country: string;
  postalCode: string | null;
  timezone: string;
}

interface ObligationInput {
  category: Category;
  title: string;
  providerName: string | null;
  recurrence: Cadence;
  dueDay: number | null;
  scheduleAnchor: Date | null;
  nextDueDate: Date | null;
  expectedAmount: bigint | null;
  currency: 'MXN';
  reminderOffsets: number[] | undefined;
  preferredMethod: string | null;
  notes: string | null;
  isActive: boolean;
}

@Injectable()
export class RecordsService {
  private injected: Error | null = null;

  constructor(
    private readonly prisma: PrismaClient | null,
    private readonly keys: IdempotencyStore,
  ) {}

  /** Next write throws inside the transaction so the row and the idempotency reservation roll apart. */
  failNextWrite(): void {
    this.injected = new Error('injected write failure');
  }

  async createProperty(
    userId: string,
    key: string | undefined,
    route: string,
    body: unknown,
  ): Promise<IdempotentResult> {
    await this.ensureUser(userId);
    return this.write(userId, key, route, body, async () => {
      const input = parsePropertyCreate(asObject(body));
      const row = await this.transaction(async (tx) => {
        const id = randomUUID();
        const created = await tx.property.create({
          data: {
            id,
            name: input.name ?? 'Casa',
            propertyType: input.propertyType,
            occupancyStatus: input.occupancyStatus,
            addressLine: input.addressLine,
            city: input.city,
            state: input.state,
            country: input.country,
            postalCode: input.postalCode,
            timezone: input.timezone,
          },
        });
        await tx.propertyMembership.create({
          data: { id: randomUUID(), propertyId: id, userId, role: 'owner', status: 'active' },
        });
        await this.audit(tx, {
          propertyId: id,
          actorUserId: userId,
          action: 'property.created',
          entityType: 'property',
          entityId: id,
          beforeState: null,
          afterState: null,
          metadata: {
            name: sealedLabel(created.name),
            timezone: created.timezone,
            addressLine: sealedLabel(created.addressLine),
          },
        });
        return created;
      });
      return { status: 201, body: propertyJson(row) };
    });
  }

  async listProperties(userId: string): Promise<{ items: unknown[] }> {
    const rows = await this.requireDb().property.findMany({
      where: {
        deletedAt: null,
        memberships: { some: { userId, status: 'active', deletedAt: null } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return { items: rows.map(propertyJson) };
  }

  async getProperty(propertyId: string): Promise<unknown> {
    const row = await this.requireDb().property.findFirst({ where: { id: propertyId, deletedAt: null } });
    if (!row) {
      throw notFoundException();
    }
    return propertyJson(row);
  }

  async updateProperty(
    userId: string,
    propertyId: string,
    key: string | undefined,
    route: string,
    body: unknown,
  ): Promise<IdempotentResult> {
    await this.ensureUser(userId);
    return this.write(userId, key, route, body, async () => {
      const patch = parsePropertyPatch(asObject(body));
      const row = await this.transaction(async (tx) => {
        await this.assertWriter(tx, userId, propertyId);
        const before = await tx.property.findFirst({ where: { id: propertyId, deletedAt: null } });
        if (!before) {
          throw notFoundException();
        }
        const updated = await tx.property.update({
          where: { id: propertyId },
          data: patch,
        });
        await this.audit(tx, {
          propertyId,
          actorUserId: userId,
          action: 'property.updated',
          entityType: 'property',
          entityId: propertyId,
          beforeState: null,
          afterState: null,
          metadata: {
            name: { before: sealedLabel(before.name), after: sealedLabel(updated.name) },
            timezone: { before: before.timezone, after: updated.timezone },
            addressLine: { before: sealedLabel(before.addressLine), after: sealedLabel(updated.addressLine) },
          },
        });
        return updated;
      });
      return { status: 200, body: propertyJson(row) };
    });
  }

  async createObligation(
    userId: string,
    propertyId: string,
    key: string | undefined,
    route: string,
    body: unknown,
  ): Promise<IdempotentResult> {
    await this.ensureUser(userId);
    return this.write(userId, key, route, body, async () => {
      const row = await this.transaction(async (tx) => {
        const property = await this.assertWriter(tx, userId, propertyId);
        const input = parseObligationCreate(asObject(body), property.timezone);
        const id = randomUUID();
        const created = await tx.obligation.create({
          data: {
            id,
            propertyId,
            category: input.category,
            title: input.title,
            providerName: input.providerName,
            recurrence: input.recurrence,
            dueDay: input.dueDay,
            scheduleAnchor: input.scheduleAnchor,
            nextDueDate: input.nextDueDate,
            expectedAmount: input.expectedAmount,
            currency: input.currency,
            reminderOffsets: input.reminderOffsets,
            preferredMethod: input.preferredMethod,
            notes: input.notes,
            isActive: input.isActive,
          },
        });
        const notes = notesState(null, created.notes);
        await this.audit(tx, {
          propertyId,
          actorUserId: userId,
          action: 'obligation.created',
          entityType: 'obligation',
          entityId: id,
          beforeState: notes.beforeState,
          afterState: notes.afterState,
          metadata: {
            title: created.title,
            category: created.category,
            expectedAmount: created.expectedAmount === null ? null : centavosToWireAmount(created.expectedAmount),
            currency: 'MXN',
          },
        });
        return created;
      });
      return { status: 201, body: obligationJson(row) };
    });
  }

  async listObligations(propertyId: string): Promise<{ items: unknown[] }> {
    const rows = await this.requireDb().obligation.findMany({
      where: { propertyId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return { items: rows.map(obligationJson) };
  }

  async getObligation(propertyId: string, obligationId: string): Promise<unknown> {
    const row = await this.requireDb().obligation.findFirst({
      where: { id: obligationId, propertyId, deletedAt: null },
    });
    if (!row) {
      throw notFoundException();
    }
    return obligationJson(row);
  }

  async updateObligation(
    userId: string,
    propertyId: string,
    obligationId: string,
    key: string | undefined,
    route: string,
    body: unknown,
  ): Promise<IdempotentResult> {
    const raw = asObject(body);
    await this.ensureUser(userId);
    return this.write(userId, key, route, body, async () => {
      const row = await this.transaction(async (tx) => {
        const property = await this.assertWriter(tx, userId, propertyId);
        const before = await tx.obligation.findFirst({
          where: { id: obligationId, propertyId, deletedAt: null },
        });
        if (!before) {
          throw notFoundException();
        }
        const patch = parseObligationPatch(raw, property.timezone, before.recurrence);
        const updated = await tx.obligation.update({
          where: { id: obligationId },
          data: patch,
        });
        const notes = notesState(before.notes, updated.notes);
        await this.audit(tx, {
          propertyId,
          actorUserId: userId,
          action: 'obligation.updated',
          entityType: 'obligation',
          entityId: obligationId,
          beforeState: notes.beforeState,
          afterState: notes.afterState,
          metadata: {
            title: { before: before.title, after: updated.title },
            isActive: { before: before.isActive, after: updated.isActive },
            recurrence: { before: before.recurrence, after: updated.recurrence },
            dueDay: { before: before.dueDay, after: updated.dueDay },
            scheduleAnchor: {
              before: before.scheduleAnchor ? dateOnly(before.scheduleAnchor) : null,
              after: updated.scheduleAnchor ? dateOnly(updated.scheduleAnchor) : null,
            },
            nextDueDate: {
              before: before.nextDueDate ? dateOnly(before.nextDueDate) : null,
              after: updated.nextDueDate ? dateOnly(updated.nextDueDate) : null,
            },
            expectedAmount: {
              before: before.expectedAmount === null ? null : centavosToWireAmount(before.expectedAmount),
              after: updated.expectedAmount === null ? null : centavosToWireAmount(updated.expectedAmount),
            },
          },
        });
        return updated;
      });
      return { status: 200, body: obligationJson(row) };
    });
  }

  async createPayment(
    userId: string,
    propertyId: string,
    key: string | undefined,
    route: string,
    body: unknown,
  ): Promise<IdempotentResult> {
    await this.ensureUser(userId);
    return this.write(userId, key, route, body, async () => {
      const raw = asObject(body);
      const recorded = await this.transaction(async (tx) => {
        const property = await this.assertWriter(tx, userId, propertyId);
        const input = parsePaymentCreate(raw, property.timezone);
        const obligation = await tx.obligation.findFirst({
          where: { id: input.obligationId, propertyId, deletedAt: null },
        });
        if (!obligation) {
          throw notFoundException();
        }
        const amountCentavos = centavosToLedgerNumber(input.amount);
        if (amountCentavos === null) {
          throw invalid('amount_invalid', 'amount must be a positive decimal peso string.');
        }
        const result = await recordPayment(
          { transaction: (work) => work(ledgerTx(tx)) },
          {
            id: randomUUID(),
            obligationId: input.obligationId,
            amountCentavos,
            paidAt: input.paidAt,
            timeZone: property.timezone,
            actorUserId: userId,
            periodDueDate: input.periodDueDate,
            markPartial: input.markPartial,
            idempotencyKey: requireKey(key),
            notes: input.notes,
            method: input.method,
            reference: input.reference,
          },
        ).catch((error: unknown) => {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            throw new IdempotencyKeyReusedException();
          }
          throw error;
        });
        if (result.payment.propertyId !== propertyId) {
          throw notFoundException();
        }
        const row = await tx.payment.findUniqueOrThrow({ where: { id: result.payment.id } });
        const notes = notesState(null, row.notes);
        await this.audit(tx, {
          propertyId,
          actorUserId: userId,
          action: 'payment.created',
          entityType: 'payment',
          entityId: row.id,
          beforeState: notes.beforeState,
          afterState: notes.afterState,
          metadata: {
            obligationId: row.obligationId,
            amount: centavosToWireAmount(row.amount),
            currency: 'MXN',
          },
        });
        return { row, warnings: result.warnings };
      });
      return { status: 201, body: { payment: paymentJson(recorded.row), warnings: recorded.warnings } };
    });
  }

  async voidPayment(
    userId: string,
    propertyId: string,
    paymentId: string,
    key: string | undefined,
    route: string,
    body: unknown,
  ): Promise<IdempotentResult> {
    await this.ensureUser(userId);
    return this.write(userId, key, route, body, async () => {
      const raw = asObject(body);
      rejectUnknown(raw, ['voidReason']);
      const row = await this.transaction(async (tx) => {
        const property = await this.assertWriter(tx, userId, propertyId);
        const existing = await tx.payment.findFirst({ where: { id: paymentId, propertyId } });
        if (!existing) {
          throw notFoundException();
        }
        const reason = voidReasonOf(raw.voidReason);
        await voidLedgerPayment(
          { transaction: (work) => work(ledgerTx(tx)) },
          { paymentId, actorUserId: userId, reason, now: new Date() },
        );
        const updated = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
        const sealed = sealAuditText('voidReason', {
          previousValue: null,
          newValue: reason,
        } as unknown as OcrConfirmAudit);
        await this.audit(tx, {
          propertyId,
          actorUserId: userId,
          action: 'payment.voided',
          entityType: 'payment',
          entityId: paymentId,
          beforeState: sealed.beforeState,
          afterState: sealed.afterState,
          metadata: { timezone: property.timezone, ...sealed.metadata },
        });
        return updated;
      });
      return { status: 200, body: paymentJson(row) };
    });
  }

  async listPayments(propertyId: string): Promise<{ items: unknown[] }> {
    const rows = await this.requireDb().payment.findMany({
      where: { propertyId },
      orderBy: { paidAt: 'desc' },
    });
    return { items: rows.map(paymentJson) };
  }

  async getPayment(propertyId: string, paymentId: string): Promise<unknown> {
    const row = await this.requireDb().payment.findFirst({ where: { id: paymentId, propertyId } });
    if (!row) {
      throw notFoundException();
    }
    return paymentJson(row);
  }

  async updatePayment(
    userId: string,
    propertyId: string,
    paymentId: string,
    key: string | undefined,
    route: string,
    body: unknown,
  ): Promise<IdempotentResult> {
    await this.ensureUser(userId);
    return this.write(userId, key, route, body, async () => {
      const raw = asObject(body);
      const row = await this.transaction(async (tx) => {
        await this.assertWriter(tx, userId, propertyId);
        const locked = await ledgerTx(tx).lockPayment(paymentId);
        if (!locked || locked.propertyId !== propertyId) {
          throw notFoundException();
        }
        if (locked.status === 'voided') {
          throw new ConflictException({
            statusCode: 409,
            error: 'payment_voided',
            message: 'A voided payment cannot be changed.',
          });
        }
        const patch = parsePaymentPatch(raw);
        const before = await tx.payment.findFirst({ where: { id: paymentId, propertyId } });
        if (!before) {
          throw notFoundException();
        }
        const updated = await tx.payment.update({ where: { id: paymentId }, data: patch });
        const notes = notesState(before.notes, updated.notes);
        await this.audit(tx, {
          propertyId,
          actorUserId: userId,
          action: 'payment.updated',
          entityType: 'payment',
          entityId: paymentId,
          beforeState: notes.beforeState,
          afterState: notes.afterState,
          metadata: {
            method: { before: before.method, after: updated.method },
            reference: { before: before.reference, after: updated.reference },
          },
        });
        return updated;
      });
      return { status: 200, body: paymentJson(row) };
    });
  }

  private async write(
    userId: string,
    key: string | undefined,
    route: string,
    body: unknown,
    work: () => Promise<IdempotentResult>,
  ): Promise<IdempotentResult> {
    const idempotencyKey = requireKey(key);
    const now = new Date();
    const space = route.indexOf(' ');
    const method = (space === -1 ? route : route.slice(0, space)).trim().toUpperCase();
    const path = stripOneTrailingSlash((space === -1 ? '' : route.slice(space + 1)).toLowerCase());
    return runIdempotent(
      this.keys,
      {
        userId,
        key: idempotencyKey,
        method,
        route: `${method} ${path}`,
        requestHash: requestHash(body),
        now,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      },
      work,
    );
  }

  private async ensureUser(userId: string): Promise<void> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
      throw ocrUnauthorized(OCR_ERROR.tokenInvalid, 'Invalid access token.');
    }
    const user = await this.requireDb().user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      throw ocrUnauthorized(OCR_ERROR.tokenInvalid, 'Invalid access token.');
    }
  }

  private async assertWriter(
    tx: Prisma.TransactionClient,
    userId: string,
    propertyId: string,
  ): Promise<{ timezone: string }> {
    const membership = await tx.propertyMembership.findFirst({
      where: {
        userId,
        propertyId,
        status: 'active',
        deletedAt: null,
        role: { in: ['owner', 'member'] },
        property: { deletedAt: null },
      },
      select: { property: { select: { timezone: true } } },
    });
    if (!membership) {
      throw notFoundException();
    }
    return { timezone: membership.property.timezone };
  }

  private async audit(
    tx: Prisma.TransactionClient,
    input: {
      propertyId: string | null;
      actorUserId: string;
      action: string;
      entityType: string;
      entityId: string;
      beforeState: unknown;
      afterState: unknown;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    await tx.auditEvent.create({
      data: {
        id: randomUUID(),
        propertyId: input.propertyId,
        actorUserId: input.actorUserId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        beforeState: jsonValue(input.beforeState),
        afterState: jsonValue(input.afterState),
        metadata: input.metadata as Prisma.InputJsonValue,
      },
    });
  }

  private transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const prisma = this.requireDb();
    return prisma.$transaction(async (tx) => {
      const result = await fn(tx);
      this.throwIfInjected();
      return result;
    });
  }

  private requireDb(): PrismaClient {
    if (!this.prisma) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'persistence_unavailable',
        message: 'Database is not configured.',
      });
    }
    return this.prisma;
  }

  private throwIfInjected(): void {
    if (!this.injected) {
      return;
    }
    const error = this.injected;
    this.injected = null;
    throw error;
  }
}

export function requestHash(body: unknown): string {
  return createHash('sha256').update(stableJson(body), 'utf8').digest('hex');
}

function requireKey(key: string | undefined): string {
  if (typeof key !== 'string') {
    throw new IdempotencyKeyInvalidException();
  }
  assertIdempotencyKey(key);
  return key;
}

function asObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException({
      statusCode: 400,
      error: 'bad_request',
      message: 'JSON object required.',
    });
  }
  return body as Record<string, unknown>;
}

function parsePropertyCreate(raw: Record<string, unknown>): PropertyInput & { name: string } {
  rejectUnknown(raw, [
    'name',
    'propertyType',
    'occupancyStatus',
    'addressLine',
    'city',
    'state',
    'country',
    'postalCode',
    'timezone',
  ]);
  if (raw.name === undefined) {
    throw invalid('text_invalid', 'name is required.');
  }
  return { ...parsePropertyFields(raw), name: assertSingleLine(raw.name, 200) };
}

function parsePropertyPatch(raw: Record<string, unknown>): Prisma.PropertyUpdateInput {
  rejectUnknown(raw, [
    'name',
    'propertyType',
    'occupancyStatus',
    'addressLine',
    'city',
    'state',
    'country',
    'postalCode',
    'timezone',
  ]);
  if (Object.keys(raw).length === 0) {
    throw invalid('field_unknown', 'At least one field is required.');
  }
  const data: Prisma.PropertyUpdateInput = {};
  if (raw.name !== undefined) data.name = assertSingleLine(raw.name, 200);
  if (raw.propertyType !== undefined) data.propertyType = oneOf(raw.propertyType, PROPERTY_TYPES, 'property_type_invalid');
  if (raw.occupancyStatus !== undefined) {
    data.occupancyStatus =
      raw.occupancyStatus === null ? null : oneOf(raw.occupancyStatus, OCCUPANCY_STATUSES, 'occupancy_invalid');
  }
  if (raw.addressLine !== undefined) data.addressLine = optionalText(raw.addressLine, 300);
  if (raw.city !== undefined) data.city = optionalText(raw.city, 120);
  if (raw.state !== undefined) data.state = optionalText(raw.state, 120);
  if (raw.country !== undefined) data.country = countryCode(raw.country);
  if (raw.postalCode !== undefined) data.postalCode = optionalText(raw.postalCode, 12);
  if (raw.timezone !== undefined) {
    if (typeof raw.timezone !== 'string') {
      assertWritablePropertyTimezone('');
    } else {
      assertWritablePropertyTimezone(raw.timezone);
      data.timezone = raw.timezone.trim();
    }
  }
  return data;
}

function parsePropertyFields(raw: Record<string, unknown>): PropertyInput {
  let timezone = 'America/Mexico_City';
  if (raw.timezone !== undefined) {
    if (typeof raw.timezone !== 'string') {
      assertWritablePropertyTimezone('');
    } else {
      assertWritablePropertyTimezone(raw.timezone);
      timezone = raw.timezone.trim();
    }
  }
  return {
    propertyType: raw.propertyType === undefined ? 'other' : oneOf(raw.propertyType, PROPERTY_TYPES, 'property_type_invalid'),
    occupancyStatus:
      raw.occupancyStatus === undefined || raw.occupancyStatus === null
        ? null
        : oneOf(raw.occupancyStatus, OCCUPANCY_STATUSES, 'occupancy_invalid'),
    addressLine: optionalText(raw.addressLine, 300),
    city: optionalText(raw.city, 120),
    state: optionalText(raw.state, 120),
    country: raw.country === undefined ? 'MX' : countryCode(raw.country),
    postalCode: optionalText(raw.postalCode, 12),
    timezone,
  };
}

function parseObligationCreate(raw: Record<string, unknown>, timeZone: string): ObligationInput {
  rejectUnknown(raw, [
    'category',
    'title',
    'providerName',
    'recurrence',
    'dueDay',
    'scheduleAnchor',
    'nextDueDate',
    'expectedAmount',
    'currency',
    'reminderOffsets',
    'preferredMethod',
    'notes',
    'isActive',
  ]);
  const recurrence = raw.recurrence === undefined ? 'monthly' : oneOf(raw.recurrence, CADENCES, 'recurrence_invalid');
  const schedule = scheduleOf(raw, recurrence);
  return {
    category: oneOf(raw.category, CATEGORIES, 'category_invalid'),
    title: assertSingleLine(raw.title, 300),
    providerName: optionalText(raw.providerName, 200),
    recurrence,
    dueDay: schedule.dueDay,
    scheduleAnchor: schedule.scheduleAnchor,
    nextDueDate: optionalDueDate(raw.nextDueDate, timeZone),
    expectedAmount: raw.expectedAmount === undefined || raw.expectedAmount === null ? null : parsePositiveCentavos(raw.expectedAmount),
    currency: currencyOf(raw.currency),
    reminderOffsets: raw.reminderOffsets === undefined ? undefined : offsets(raw.reminderOffsets),
    preferredMethod: optionalText(raw.preferredMethod, 80),
    notes: raw.notes === undefined || raw.notes === null ? null : assertNotes(raw.notes),
    isActive: raw.isActive === undefined ? true : bool(raw.isActive),
  };
}

function parseObligationPatch(
  raw: Record<string, unknown>,
  timeZone: string,
  recurrence: Cadence,
): Prisma.ObligationUpdateInput {
  rejectUnknown(raw, [
    'category',
    'title',
    'providerName',
    'recurrence',
    'dueDay',
    'scheduleAnchor',
    'nextDueDate',
    'expectedAmount',
    'currency',
    'reminderOffsets',
    'preferredMethod',
    'notes',
    'isActive',
  ]);
  if (Object.keys(raw).length === 0) {
    throw invalid('field_unknown', 'At least one field is required.');
  }
  if (raw.isActive === true) {
    throw invalid('resume_route_required', 'Resume is a separate route.');
  }
  const data: Prisma.ObligationUpdateInput = {};
  if (raw.category !== undefined) data.category = oneOf(raw.category, CATEGORIES, 'category_invalid');
  if (raw.title !== undefined) data.title = assertSingleLine(raw.title, 300);
  if (raw.providerName !== undefined) data.providerName = optionalText(raw.providerName, 200);
  if (raw.recurrence !== undefined) data.recurrence = oneOf(raw.recurrence, CADENCES, 'recurrence_invalid');
  const nextCadence = raw.recurrence === undefined ? recurrence : oneOf(raw.recurrence, CADENCES, 'recurrence_invalid');
  if (raw.dueDay !== undefined || raw.scheduleAnchor !== undefined || raw.recurrence !== undefined) {
    const schedule = scheduleOf(raw, nextCadence);
    if (raw.dueDay !== undefined || SCHEDULED.has(nextCadence)) data.dueDay = schedule.dueDay;
    if (raw.scheduleAnchor !== undefined || SCHEDULED.has(nextCadence)) data.scheduleAnchor = schedule.scheduleAnchor;
  }
  if (raw.nextDueDate !== undefined) data.nextDueDate = optionalDueDate(raw.nextDueDate, timeZone);
  if (raw.expectedAmount !== undefined) {
    data.expectedAmount = raw.expectedAmount === null ? null : parsePositiveCentavos(raw.expectedAmount);
  }
  if (raw.currency !== undefined) data.currency = currencyOf(raw.currency);
  if (raw.reminderOffsets !== undefined) data.reminderOffsets = offsets(raw.reminderOffsets);
  if (raw.preferredMethod !== undefined) data.preferredMethod = optionalText(raw.preferredMethod, 80);
  if (raw.notes !== undefined) data.notes = raw.notes === null ? null : assertNotes(raw.notes);
  if (raw.isActive !== undefined) data.isActive = bool(raw.isActive);
  return data;
}

function parsePaymentCreate(raw: Record<string, unknown>, timeZone: string): {
  obligationId: string;
  amount: bigint;
  paidAt: Date;
  periodDueDate?: string;
  markPartial: boolean;
  method: string | null;
  reference: string | null;
  notes: string | null;
} {
  rejectUnknown(raw, [
    'obligationId',
    'amount',
    'currency',
    'paidAt',
    'periodDueDate',
    'markPartial',
    'method',
    'reference',
    'notes',
  ]);
  currencyOf(raw.currency);
  if (typeof raw.obligationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(raw.obligationId)) {
    throw invalid('obligation_invalid', 'obligationId must be a UUID on this property.');
  }
  if (raw.markPartial !== undefined && typeof raw.markPartial !== 'boolean') {
    throw invalid('mark_partial_invalid', 'markPartial must be a boolean.');
  }
  if (typeof raw.paidAt !== 'string') {
    throw invalid('paid_at_out_of_range', 'paidAt is outside the allowed range.');
  }
  const paidAt = new Date(raw.paidAt);
  assertPaidAt(paidAt, new Date(), timeZone);
  return {
    obligationId: raw.obligationId,
    amount: parsePositiveCentavos(raw.amount),
    paidAt,
    periodDueDate:
      raw.periodDueDate === undefined
        ? undefined
        : dateOnly(requiredDate(raw.periodDueDate, 'period_due_date_invalid')),
    markPartial: raw.markPartial === true,
    method: optionalText(raw.method, 80),
    reference: optionalText(raw.reference, 120),
    notes: raw.notes === undefined || raw.notes === null ? null : assertNotes(raw.notes),
  };
}

function voidReasonOf(value: unknown): string {
  if (typeof value !== 'string') {
    throw invalid('void_reason_invalid', 'voidReason must be 1 to 500 characters.');
  }
  const trimmed = value.trim();
  try {
    return assertSingleLine(trimmed, 500);
  } catch {
    throw invalid('void_reason_invalid', 'voidReason must be 1 to 500 characters.');
  }
}

function parsePaymentPatch(raw: Record<string, unknown>): Prisma.PaymentUpdateInput {
  rejectUnknown(raw, ['notes', 'method', 'reference']);
  if (Object.keys(raw).length === 0) {
    throw invalid('field_unknown', 'At least one field is required.');
  }
  const data: Prisma.PaymentUpdateInput = {};
  if (raw.notes !== undefined) data.notes = raw.notes === null ? null : assertNotes(raw.notes);
  if (raw.method !== undefined) data.method = optionalText(raw.method, 80);
  if (raw.reference !== undefined) data.reference = optionalText(raw.reference, 120);
  return data;
}

function scheduleOf(raw: Record<string, unknown>, recurrence: Cadence): {
  dueDay: number | null;
  scheduleAnchor: Date | null;
} {
  const needs = SCHEDULED.has(recurrence);
  const dueDay = raw.dueDay === undefined || raw.dueDay === null ? null : dueDayOf(raw.dueDay);
  const scheduleAnchor =
    raw.scheduleAnchor === undefined || raw.scheduleAnchor === null
      ? null
      : requiredDate(raw.scheduleAnchor, 'schedule_anchor_invalid');
  if (needs && (dueDay === null || scheduleAnchor === null)) {
    throw invalid('schedule_invalid', 'dueDay and scheduleAnchor are required for this recurrence.');
  }
  return { dueDay, scheduleAnchor };
}

function dueDayOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 31) {
    throw invalid('due_day_invalid', 'dueDay must be an integer from 1 to 31.');
  }
  return value;
}

function optionalDueDate(value: unknown, timeZone: string): Date | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw invalid('next_due_date_out_of_range', 'nextDueDate is outside the allowed range.');
  }
  assertNextDueDateInRange(value, new Date(), timeZone);
  return requiredDate(value, 'next_due_date_out_of_range');
}

function requiredDate(value: unknown, error: string): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw invalid(error, 'Date must be YYYY-MM-DD.');
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw invalid(error, 'Date must be YYYY-MM-DD.');
  }
  return date;
}

function currencyOf(value: unknown): 'MXN' {
  if (value === undefined || value === 'MXN') {
    return 'MXN';
  }
  throw invalid('currency_invalid', 'currency must be MXN.');
}

function offsets(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10) {
    throw invalid('reminder_offsets_invalid', 'reminderOffsets must be a short list of integers.');
  }
  return value.map((item) => {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 0 || item > 365) {
      throw invalid('reminder_offsets_invalid', 'reminderOffsets must be a short list of integers.');
    }
    return item;
  });
}

function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw invalid('field_invalid', 'isActive must be a boolean.');
  }
  return value;
}

function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return assertSingleLine(value, max);
}

function countryCode(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z]{2}$/.test(value)) {
    throw invalid('country_invalid', 'country must be two letters.');
  }
  return value.toUpperCase();
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], error: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw invalid(error, 'Value is not one of the allowed choices.');
  }
  return value as T;
}

function rejectUnknown(raw: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      throw invalid('field_unknown', 'Unknown field.');
    }
  }
}

function invalid(error: string, message: string): UnprocessableEntityException {
  return new UnprocessableEntityException({ statusCode: 422, error, message });
}

function sealedLabel(value: string | null): { length: number; sha256: string } | null {
  if (!value) {
    return null;
  }
  return redactedTextState(value);
}

function notesState(before: string | null, after: string | null): { beforeState: unknown; afterState: unknown } {
  if (before === null && after === null) {
    return { beforeState: null, afterState: null };
  }
  const sealed = sealAuditText('notes', {
    previousValue: before,
    newValue: after,
  } as unknown as OcrConfirmAudit);
  return { beforeState: sealed.beforeState, afterState: sealed.afterState };
}

function jsonValue(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null || value === undefined) {
    return Prisma.JsonNull;
  }
  return value as Prisma.InputJsonValue;
}

function propertyJson(row: {
  id: string;
  name: string;
  propertyType: PropertyType;
  occupancyStatus: OccupancyStatus | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  country: string;
  postalCode: string | null;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
}): unknown {
  return toPropertyResponse(row);
}

function obligationJson(row: {
  id: string;
  propertyId: string;
  category: Category;
  title: string;
  providerName: string | null;
  recurrence: Cadence;
  dueDay: number | null;
  scheduleAnchor: Date | null;
  nextDueDate: Date | null;
  expectedAmount: bigint | null;
  currency: string;
  reminderOffsets: number[];
  preferredMethod: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): unknown {
  return {
    id: row.id,
    propertyId: row.propertyId,
    category: row.category,
    title: row.title,
    providerName: row.providerName,
    recurrence: row.recurrence,
    dueDay: row.dueDay,
    scheduleAnchor: row.scheduleAnchor ? dateOnly(row.scheduleAnchor) : null,
    nextDueDate: row.nextDueDate ? dateOnly(row.nextDueDate) : null,
    expectedAmount: row.expectedAmount === null ? null : centavosToWireAmount(row.expectedAmount),
    currency: 'MXN',
    reminderOffsets: row.reminderOffsets,
    preferredMethod: row.preferredMethod,
    notes: row.notes,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function paymentJson(row: {
  id: string;
  propertyId: string;
  obligationId: string;
  periodDueDate: Date;
  amount: bigint;
  currency: string;
  paidAt: Date;
  method: string | null;
  reference: string | null;
  notes: string | null;
  status: string;
  voidedAt?: Date | null;
  voidReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}): unknown {
  return {
    id: row.id,
    propertyId: row.propertyId,
    obligationId: row.obligationId,
    periodDueDate: dateOnly(row.periodDueDate),
    amount: centavosToWireAmount(row.amount),
    currency: 'MXN',
    paidAt: row.paidAt.toISOString(),
    method: row.method,
    reference: row.reference,
    notes: row.notes,
    status: row.status,
    voidedAt: row.voidedAt ? row.voidedAt.toISOString() : null,
    voidReason: row.voidReason ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function dateOnly(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
