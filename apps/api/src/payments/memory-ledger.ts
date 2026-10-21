import type { LedgerStore, LedgerTx, ObligationSnapshot, PaymentSnapshot } from './ledger.js';

interface LedgerState {
  obligations: Map<string, ObligationSnapshot>;
  payments: Map<string, PaymentSnapshot>;
}

export class MemoryLedger implements LedgerStore {
  constructor(private state: LedgerState) {}

  static create(obligations: ObligationSnapshot[] = [], payments: PaymentSnapshot[] = []): MemoryLedger {
    return new MemoryLedger({
      obligations: new Map(obligations.map((row) => [row.id, { ...row }])),
      payments: new Map(payments.map((row) => [row.id, { ...row }])),
    });
  }

  obligation(id: string): ObligationSnapshot | undefined {
    const row = this.state.obligations.get(id);
    return row ? { ...row } : undefined;
  }

  payment(id: string): PaymentSnapshot | undefined {
    const row = this.state.payments.get(id);
    return row ? { ...row } : undefined;
  }

  async transaction<T>(work: (tx: LedgerTx) => Promise<T>): Promise<T> {
    const snapshot = cloneState(this.state);
    const tx = new MemoryLedgerTx(this.state);
    try {
      return await work(tx);
    } catch (error) {
      this.state = snapshot;
      throw error;
    }
  }
}

class MemoryLedgerTx implements LedgerTx {
  constructor(private readonly state: LedgerState) {}

  async lockObligation(id: string): Promise<ObligationSnapshot | null> {
    const row = this.state.obligations.get(id);
    return row ? { ...row } : null;
  }

  async saveNextDueDate(id: string, nextDueDate: string | null): Promise<void> {
    const row = this.state.obligations.get(id);
    if (!row) {
      return;
    }
    row.nextDueDate = nextDueDate;
  }

  async insertPayment(row: PaymentSnapshot): Promise<void> {
    this.state.payments.set(row.id, { ...row });
  }

  async findPayment(id: string): Promise<PaymentSnapshot | null> {
    const row = this.state.payments.get(id);
    return row ? { ...row } : null;
  }

  async lockPayment(id: string): Promise<PaymentSnapshot | null> {
    return this.findPayment(id);
  }

  async markVoided(row: PaymentSnapshot): Promise<void> {
    this.state.payments.set(row.id, { ...row });
  }

  async lockPayments(obligationId: string): Promise<PaymentSnapshot[]> {
    return [...this.state.payments.values()]
      .filter((row) => row.obligationId === obligationId)
      .map((row) => ({ ...row }));
  }
}

function cloneState(state: LedgerState): LedgerState {
  return {
    obligations: new Map([...state.obligations].map(([id, row]) => [id, { ...row }])),
    payments: new Map([...state.payments].map(([id, row]) => [id, { ...row }])),
  };
}
