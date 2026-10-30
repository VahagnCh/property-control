import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

function specRules(markdown: string): string[] {
  return markdown.split('\n').flatMap((line) => {
    const match = line.match(/^- \*\*(EC-\d+\.\d+)\*\* (.+)$/);
    return match ? [`${match[1]} ${match[2]}`] : [];
  });
}

function todoTitles(source: string): string[] {
  return [...source.matchAll(/it\.todo\("((?:\\.|[^"\\])*)"\);/g)].map((match) =>
    JSON.parse(`"${match[1]}"`) as string,
  );
}

/** Section 15 rows, in spec order. Earlier ids stay where they are. */
const section15Ids = [
  'EC-15.1',
  'EC-15.2',
  'EC-15.3',
  'EC-15.4',
  'EC-15.5',
  'EC-15.6',
  'EC-15.7',
  'EC-15.8',
  'EC-15.9',
  'EC-15.10',
  'EC-15.11',
] as const;

function ruleId(rule: string): string {
  return rule.slice(0, rule.indexOf(' '));
}

describe('edge-case spec coverage', () => {
  const spec = read('docs/EDGE_CASES.md');
  const tests = read('apps/api/test/edge-cases.spec.ts');
  const rules = specRules(spec);
  const titles = todoTitles(tests);

  it('gives every EDGE_CASES rule a todo test with the same sentence', () => {
    expect(rules.length).toBeGreaterThan(0);
    expect(titles).toEqual(rules);
  });

  it('appends the section 15 coverage rows after EC-14.4', () => {
    const ids = rules.map(ruleId);
    const start = ids.indexOf('EC-15.1');
    expect(start).toBeGreaterThan(0);
    expect(ids[start - 1]).toBe('EC-14.4');
    expect(ids.slice(start)).toEqual([...section15Ids]);
    expect(ids.indexOf('EC-8.3')).toBe(ids.indexOf('EC-8.2') + 1);
    expect(ids.indexOf('EC-9.1')).toBe(ids.indexOf('EC-8.3') + 1);
    expect(ids.filter((id) => id.startsWith('EC-15.'))).toEqual([...section15Ids]);
  });

  it('keeps the payment, period, reminder, and invite schema aligned', () => {
    const schema = read('apps/api/prisma/schema.prisma');
    const payment = schema.match(/model Payment \{[\s\S]*?\n\}/);
    expect(payment).not.toBeNull();
    const paymentModel = payment?.[0] ?? '';
    expect(paymentModel).not.toContain('deletedAt');
    expect(paymentModel).toContain('voidedAt');
    expect(paymentModel).toContain('voidedByUserId');
    expect(paymentModel).toContain('voidReason');
    expect(paymentModel).toContain('periodDueDate');
    expect(paymentModel).toMatch(/amount\s+BigInt/);

    expect(schema).toContain('overpaidAmount');
    expect(schema).toMatch(/overpaidAmount\s+BigInt/);
    expect(schema).toContain('dueDay');
    expect(schema).toContain('scheduleAnchor');
    expect(schema).toContain('model MembershipInvite');
    expect(schema).toContain('model NotificationDelivery');
    expect(schema).toContain('model ObligationPauseInterval');
    expect(schema).toContain('@default("America/Mexico_City")');
    expect(schema).toContain('obligations_next_due_date_sanity');
    expect(schema).toContain('notification_deliveries_idempotency_key');

    const sql = read('apps/api/prisma/sql/checks.sql');
    expect(sql).toContain('reminders_obligation_id_scheduled_for_channel_key');
    expect(sql).toContain('WHERE obligation_id IS NOT NULL');
    expect(sql).toContain('reminders_maintenance_task_id_scheduled_for_channel_key');
    expect(sql).toContain('WHERE maintenance_task_id IS NOT NULL');
    expect(sql).toContain('obligations_next_due_date_sanity');
    expect(sql).toContain("DATE '1990-01-01'");
    expect(sql).toContain("DATE '2100-12-31'");

    const payments = read('apps/api/src/payments/payments.module.ts');
    expect(payments).not.toContain('@Delete');
    expect(payments).toContain("@Post(':paymentId/void')");
  });

  it('uses one upload-url JSON shape in API.md and TRUST.md', () => {
    const blocks = ['docs/API.md', 'docs/TRUST.md'].map((path) => {
      const matches = [...read(path).matchAll(/```json\n([\s\S]*?)```/g)]
        .map((match) => match[1])
        .filter((body) => body.includes('"uploadUrl"'));
      expect(matches).toHaveLength(1);
      return matches[0];
    });
    expect(blocks[0]).toBe(blocks[1]);
    for (const block of blocks) {
      expect(block).not.toMatch(/storageKey/);
      expect(block).not.toMatch(/storage_key/);
      const parsed = JSON.parse(block ?? '{}') as {
        response?: { body?: { evidence?: Record<string, unknown>; uploadUrl?: unknown } };
      };
      expect(parsed.response?.body?.evidence).not.toHaveProperty('storageKey');
      expect(parsed.response?.body?.evidence).toHaveProperty('fileId');
      expect(JSON.stringify(parsed)).not.toMatch(/properties\/<propertyId>\/evidence/);
    }
    expect(JSON.parse(blocks[0] ?? '{}')).toHaveProperty('response.body.uploadUrl');
  });
});
