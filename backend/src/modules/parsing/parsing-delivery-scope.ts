// One scope belongs to one broker channel. Reconnection cancels and drains its
// parser requests before another channel may receive file work.
export class ParsingDeliveryScope {
  private readonly controller = new AbortController();
  private readonly pending = new Set<Promise<void>>();
  readonly signal: AbortSignal;
  constructor(shutdownSignal: AbortSignal) {
    this.signal = AbortSignal.any([shutdownSignal, this.controller.signal]);
  }
  run(work: (signal: AbortSignal) => Promise<void>) {
    if (this.signal.aborted) return Promise.resolve();
    const pending = work(this.signal);
    this.pending.add(pending);
    void pending.then(
      () => this.pending.delete(pending),
      () => this.pending.delete(pending),
    );
    return pending;
  }
  cancel() {
    this.controller.abort();
  }
  async drain() {
    this.cancel();
    await Promise.allSettled(this.pending);
  }
}
