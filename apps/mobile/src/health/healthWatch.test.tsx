import { act, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { COPY } from '../copy/userFacing';
import { HealthBanner, LaunchHealth } from './HealthBanner';
import {
  FOREGROUND_HEALTH_AFTER_MS,
  HEALTH_GIVE_UP_AFTER_MS,
  HealthWatch,
  type HealthClock,
  type HealthWatchSnapshot,
} from './healthWatch';

function makeClock(): HealthClock & { jump: (ms: number) => void } {
  let t = 0;
  const timers: Array<{ at: number; fn: () => void; dead: boolean }> = [];
  const clock: HealthClock & { jump: (ms: number) => void } = {
    now: () => t,
    schedule(ms, fn) {
      const timer = { at: t + ms, fn, dead: false };
      timers.push(timer);
      return () => {
        timer.dead = true;
      };
    },
    async wait(ms) {
      t += ms;
      clock.jump(t);
    },
    jump(ms) {
      t = ms;
      const due = timers.filter((timer) => !timer.dead && timer.at <= t);
      for (const timer of due) {
        timer.dead = true;
        timer.fn();
      }
    },
  };
  return clock;
}

async function flush(): Promise<void> {
  for (let step = 0; step < 10; step += 1) {
    await Promise.resolve();
  }
}

describe('launch and background health', () => {
  it('backs off the launch poll by 1, 2, 4, then 8 seconds', async () => {
    const waits: number[] = [];
    let t = 0;
    const watch = new HealthWatch(
      async () => 'down',
      {
        now: () => t,
        schedule: () => () => undefined,
        async wait(ms: number) {
          waits.push(ms);
          t += ms;
        },
      },
    );
    watch.start();
    for (let step = 0; step < 40; step += 1) {
      await Promise.resolve();
    }
    expect(waits.slice(0, 5)).toEqual([1_000, 2_000, 4_000, 8_000, 8_000]);
    expect(watch.current().phase).toBe('failed');
    expect(t).toBeGreaterThanOrEqual(HEALTH_GIVE_UP_AFTER_MS);
  });

  it('shows connecting copy at 3s and 8s, then failed with Reintentar at 90s', async () => {
    let release: (result: 'ok' | 'down') => void = () => undefined;
    const clock = makeClock();
    const seen: HealthWatchSnapshot[] = [];
    const watch = new HealthWatch(
      () =>
        new Promise<'ok' | 'down'>((resolve) => {
          release = resolve;
        }),
      clock,
    );
    watch.subscribe((snapshot) => seen.push(snapshot));
    watch.start();
    expect(watch.current()).toEqual({ phase: 'checking', copyKey: null, slow: false, retryLabel: null });

    clock.jump(3_000);
    expect(watch.current().copyKey).toBe('common.connecting');
    expect(watch.current().slow).toBe(false);
    clock.jump(8_000);
    expect(watch.current().copyKey).toBe('common.connecting');
    expect(watch.current().slow).toBe(true);
    clock.jump(HEALTH_GIVE_UP_AFTER_MS);
    expect(watch.current()).toEqual({
      phase: 'failed',
      copyKey: 'common.connecting.failed',
      slow: false,
      retryLabel: 'Reintentar',
    });

    release('ok');
    await flush();
    expect(watch.current().phase).toBe('failed');
    expect(seen.map((snapshot) => snapshot.copyKey)).toEqual([
      null,
      'common.connecting',
      'common.connecting',
      'common.connecting.failed',
    ]);
    expect(seen.map((snapshot) => snapshot.slow)).toEqual([false, false, true, false]);
  });

  it('goes idle when health succeeds before the 3s copy', async () => {
    const clock = makeClock();
    const watch = new HealthWatch(async () => 'ok', clock);
    watch.start();
    await flush();
    expect(watch.current()).toEqual({ phase: 'idle', copyKey: null, slow: false, retryLabel: null });
    clock.jump(HEALTH_GIVE_UP_AFTER_MS);
    expect(watch.current().copyKey).toBeNull();
  });

  it('checks on launch and again only after more than 10 minutes in the background', async () => {
    const clock = makeClock();
    let probes = 0;
    const watch = new HealthWatch(async () => {
      probes += 1;
      return 'ok';
    }, clock);
    watch.noteAppState('background');
    clock.jump(FOREGROUND_HEALTH_AFTER_MS);
    watch.noteAppState('active');
    await flush();
    expect(probes).toBe(0);

    watch.start();
    await flush();
    expect(probes).toBe(1);

    watch.noteAppState('background');
    clock.jump(clock.now() + FOREGROUND_HEALTH_AFTER_MS);
    watch.noteAppState('active');
    await flush();
    expect(probes).toBe(1);

    watch.noteAppState('background');
    clock.jump(clock.now() + FOREGROUND_HEALTH_AFTER_MS + 1);
    watch.noteAppState('active');
    await flush();
    expect(probes).toBe(2);
  });

  it('stops a down health check at 90s', async () => {
    const clock = makeClock();
    let probes = 0;
    const watch = new HealthWatch(async () => {
      probes += 1;
      return 'down';
    }, clock);
    watch.start();
    for (let step = 0; step < 400; step += 1) {
      await Promise.resolve();
    }
    expect(watch.current().phase).toBe('failed');
    expect(watch.current().copyKey).toBe('common.connecting.failed');
    expect(probes).toBeGreaterThan(1);
    expect(probes).toBeLessThan(100);
  });

  it('renders the failed banner from the launch watch', async () => {
    const clock = makeClock();
    let release: (result: 'ok' | 'down') => void = () => undefined;
    const watch = new HealthWatch(
      () =>
        new Promise<'ok' | 'down'>((resolve) => {
          release = resolve;
        }),
      clock,
    );
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
    try {
      render(<LaunchHealth watch={watch} />);
      await flush();
      expect(screen.queryByTestId('health-banner')).toBeNull();
      await act(async () => {
        clock.jump(HEALTH_GIVE_UP_AFTER_MS);
      });
      expect(screen.getByText(COPY['common.connecting.failed'])).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy();
      release('down');
      await flush();
    } finally {
      spy.mockRestore();
    }
  });

  it('renders each connecting string from a snapshot', () => {
    const { rerender } = render(
      <HealthBanner
        snapshot={{ phase: 'checking', copyKey: 'common.connecting', slow: false, retryLabel: null }}
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByText(COPY['common.connecting'])).toBeTruthy();
    rerender(
      <HealthBanner
        snapshot={{ phase: 'checking', copyKey: 'common.connecting', slow: true, retryLabel: null }}
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByText(COPY['common.connecting'])).toBeTruthy();
    expect(screen.getByText(COPY['common.connecting.slow'])).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
  });
});
