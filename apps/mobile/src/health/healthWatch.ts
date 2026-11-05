import { SCREEN_STATE_COPY, type CopyKey } from '../copy/userFacing';

/** EC-11.2. Connecting copy appears at these elapsed times, not before. */
export const HEALTH_CONNECTING_AFTER_MS = 3_000;
export const HEALTH_SLOW_AFTER_MS = 8_000;
export const HEALTH_GIVE_UP_AFTER_MS = 90_000;

/** A return to the foreground after longer than this runs the health check again. */
export const FOREGROUND_HEALTH_AFTER_MS = 10 * 60 * 1000;

export type HealthCopyKey = Extract<
  CopyKey,
  'common.connecting' | 'common.connecting.slow' | 'common.connecting.failed'
>;

export type HealthWatchSnapshot = {
  phase: 'idle' | 'checking' | 'failed';
  copyKey: HealthCopyKey | null;
  retryLabel: string | null;
};

export type HealthProbe = () => Promise<'ok' | 'down'>;

export type HealthClock = {
  now: () => number;
  schedule: (ms: number, fn: () => void) => () => void;
  wait: (ms: number) => Promise<void>;
};

const IDLE: HealthWatchSnapshot = { phase: 'idle', copyKey: null, retryLabel: null };

/**
 * Launch and background-return health. Copy is empty until 3s, then
 * common.connecting, common.connecting.slow at 8s, and common.connecting.failed
 * with Reintentar at 90s. Each probe is one GET, which itself retries once
 * on a network error. The watch keeps probing until ok or 90s. It does not
 * retry writes.
 */
export class HealthWatch {
  private snapshot: HealthWatchSnapshot = IDLE;
  private readonly listeners = new Set<(snapshot: HealthWatchSnapshot) => void>();
  private startedAt: number | null = null;
  private backgroundedAt: number | null = null;
  private generation = 0;
  private readonly cancels: Array<() => void> = [];

  constructor(
    private readonly probe: HealthProbe,
    private readonly clock: HealthClock,
  ) {}

  current(): HealthWatchSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: HealthWatchSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Launch, or Reintentar after the 90s failure. */
  start(): void {
    this.stopTimers();
    const generation = ++this.generation;
    this.startedAt = this.clock.now();
    this.publish({ phase: 'checking', copyKey: null, retryLabel: null });
    this.arm(generation, HEALTH_CONNECTING_AFTER_MS, 'common.connecting');
    this.arm(generation, HEALTH_SLOW_AFTER_MS, 'common.connecting.slow');
    this.clockArm(generation, HEALTH_GIVE_UP_AFTER_MS, () => {
      this.fail(generation);
    });
    void this.loop(generation);
  }

  stop(): void {
    this.generation += 1;
    this.stopTimers();
  }

  /**
   * Background remembers the time. Coming back after more than 10 minutes
   * starts the check. A shorter absence does not.
   */
  noteAppState(state: 'active' | 'background' | 'inactive'): void {
    if (state === 'background' || state === 'inactive') {
      this.backgroundedAt = this.clock.now();
      return;
    }
    if (this.backgroundedAt === null) {
      return;
    }
    const away = this.clock.now() - this.backgroundedAt;
    this.backgroundedAt = null;
    if (away > FOREGROUND_HEALTH_AFTER_MS) {
      this.start();
    }
  }

  private async loop(generation: number): Promise<void> {
    while (this.generation === generation && this.snapshot.phase === 'checking') {
      const started = this.startedAt ?? this.clock.now();
      if (this.clock.now() - started >= HEALTH_GIVE_UP_AFTER_MS) {
        this.fail(generation);
        return;
      }
      let result: 'ok' | 'down' = 'down';
      try {
        result = await this.probe();
      } catch {
        result = 'down';
      }
      if (this.generation !== generation || this.snapshot.phase !== 'checking') {
        return;
      }
      if (result === 'ok') {
        this.succeed(generation);
        return;
      }
      const elapsed = this.clock.now() - started;
      if (elapsed >= HEALTH_GIVE_UP_AFTER_MS) {
        this.fail(generation);
        return;
      }
      await this.clock.wait(Math.min(1_000, HEALTH_GIVE_UP_AFTER_MS - elapsed));
    }
  }

  private succeed(generation: number): void {
    if (this.generation !== generation) {
      return;
    }
    this.generation += 1;
    this.stopTimers();
    this.publish(IDLE);
  }

  private fail(generation: number): void {
    if (this.generation !== generation) {
      return;
    }
    this.generation += 1;
    this.stopTimers();
    this.publish({
      phase: 'failed',
      copyKey: 'common.connecting.failed',
      retryLabel: SCREEN_STATE_COPY.retry,
    });
  }

  private arm(generation: number, afterMs: number, copyKey: HealthCopyKey): void {
    this.clockArm(generation, afterMs, () => {
      if (this.generation !== generation || this.snapshot.phase !== 'checking') {
        return;
      }
      this.publish({ phase: 'checking', copyKey, retryLabel: null });
    });
  }

  private clockArm(generation: number, afterMs: number, fn: () => void): void {
    const cancel = this.clock.schedule(afterMs, () => {
      if (this.generation !== generation) {
        return;
      }
      fn();
    });
    this.cancels.push(cancel);
  }

  private stopTimers(): void {
    for (const cancel of this.cancels) {
      cancel();
    }
    this.cancels.length = 0;
  }

  private publish(snapshot: HealthWatchSnapshot): void {
    this.snapshot = Object.freeze({ ...snapshot });
    for (const listener of [...this.listeners]) {
      listener(this.snapshot);
    }
  }
}

export const realHealthClock: HealthClock = {
  now: () => Date.now(),
  schedule(ms, fn) {
    const id = setTimeout(fn, ms);
    return () => {
      clearTimeout(id);
    };
  },
  wait: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
};
