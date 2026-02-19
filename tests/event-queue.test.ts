import { describe, it, expect } from 'vitest';
import { EventQueue } from '../src/event-queue.js';

describe('EventQueue', () => {
  it('dequeues items in order', async () => {
    const q = new EventQueue<number>();
    q.push(1);
    q.push(2);
    expect(await q.dequeue()).toBe(1);
    expect(await q.dequeue()).toBe(2);
  });

  it('blocks until an item is pushed', async () => {
    const q = new EventQueue<string>();
    const promise = q.dequeue();

    // Push after a delay
    setTimeout(() => q.push('hello'), 10);

    const result = await promise;
    expect(result).toBe('hello');
  });

  it('resolves immediately if item already queued', async () => {
    const q = new EventQueue<number>();
    q.push(42);
    const result = await q.dequeue();
    expect(result).toBe(42);
  });

  // --- tryDequeue ---
  it('tryDequeue returns item from queue immediately', async () => {
    const q = new EventQueue<number>();
    q.push(99);
    const result = await q.tryDequeue(1000);
    expect(result).toBe(99);
  });

  it('tryDequeue returns null on timeout', async () => {
    const q = new EventQueue<number>();
    const result = await q.tryDequeue(20);
    expect(result).toBeNull();
  });

  it('tryDequeue returns item pushed before timeout', async () => {
    const q = new EventQueue<string>();
    const promise = q.tryDequeue(500);
    setTimeout(() => q.push('arrived'), 10);
    const result = await promise;
    expect(result).toBe('arrived');
  });

  it('tryDequeue clears resolve after timeout', async () => {
    const q = new EventQueue<number>();
    await q.tryDequeue(10);
    // After timeout, pushing should enqueue (not resolve stale waiter)
    q.push(1);
    expect(await q.dequeue()).toBe(1);
  });
});
