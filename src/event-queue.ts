export class EventQueue<T> {
  private queue: T[] = [];
  private resolve: ((value: T) => void) | null = null;

  push(item: T): void {
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r(item);
    } else {
      this.queue.push(item);
    }
  }

  async dequeue(): Promise<T> {
    if (this.queue.length > 0) return this.queue.shift()!;
    return new Promise<T>((resolve) => { this.resolve = resolve; });
  }

  /** Returns next item or null after timeoutMs. */
  async tryDequeue(timeoutMs: number): Promise<T | null> {
    if (this.queue.length > 0) return this.queue.shift()!;
    return new Promise<T | null>((resolve) => {
      const timer = setTimeout(() => {
        this.resolve = null;
        resolve(null);
      }, timeoutMs);
      this.resolve = (value: T) => {
        clearTimeout(timer);
        resolve(value);
      };
    });
  }
}
