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
  return [...source.matchAll(/it\.todo\("([\s\S]*?)"\);/g)].map((match) =>
    JSON.parse(`"${match[1]}"`) as string,
  );
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
    expect(paymentModel).toMatch(/amount\s+Int/);

    expect(schema).toContain('overpaidAmount');
    expect(schema).toContain('dueDay');
    expect(schema).toContain('scheduleAnchor');
    expect(schema).toContain('model MembershipInvite');
    expect(schema).toContain('model NotificationDelivery');
    expect(schema).toContain('model ObligationPauseInterval');
    expect(schema).toContain('@default("America/Mexico_City")');
    expect(schema).toContain('notification_deliveries_idempotency_key');

    const sql = read('apps/api/prisma/sql/checks.sql');
    expect(sql).toContain('reminders_obligation_id_scheduled_for_channel_key');
    expect(sql).toContain('WHERE obligation_id IS NOT NULL');
    expect(sql).toContain('reminders_maintenance_task_id_scheduled_for_channel_key');
    expect(sql).toContain('WHERE maintenance_task_id IS NOT NULL');

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
    expect(JSON.parse(blocks[0] ?? '{}')).toHaveProperty('response.body.uploadUrl');
  });
});
