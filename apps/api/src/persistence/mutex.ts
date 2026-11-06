/** Serializes in-process critical sections. Postgres transactions cover other instances. */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

/** One mutex per key, so parallel sends for one email stay in order. */
export class KeyedMutex {
  private readonly keys = new Map<string, Mutex>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const mutex = this.keys.get(key) ?? new Mutex();
    this.keys.set(key, mutex);
    return mutex.run(fn);
  }
}
