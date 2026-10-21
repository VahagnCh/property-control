export const CLOCK = Symbol('CLOCK');

export interface Clock {
  now(): number;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

export class ManualClock implements Clock {
  constructor(public nowMs: number) {}

  now(): number {
    return this.nowMs;
  }
}
