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
    setTimeout(() => q.push('hello'), 10);
    expect(await promise).toBe('hello');
  });

  it('resolves immediately if item already queued', async () => {
    const q = new EventQueue<number>();
    q.push(42);
    expect(await q.dequeue()).toBe(42);
  });

  it('push resolves a pending dequeue immediately', async () => {
    const q = new EventQueue<string>();
    const p1 = q.dequeue();
    q.push('first');
    q.push('second'); // goes to queue since resolve was consumed
    expect(await p1).toBe('first');
    expect(await q.dequeue()).toBe('second');
  });

  describe('tryDequeue', () => {
    it('returns item immediately if already queued', async () => {
      const q = new EventQueue<string>();
      q.push('ready');
      expect(await q.tryDequeue(1000)).toBe('ready');
    });

    it('returns null after timeout when no item arrives', async () => {
      const q = new EventQueue<string>();
      const result = await q.tryDequeue(50);
      expect(result).toBeNull();
    });

    it('returns item pushed before timeout expires', async () => {
      const q = new EventQueue<number>();
      setTimeout(() => q.push(99), 10);
      expect(await q.tryDequeue(5000)).toBe(99);
    });

    it('clears pending resolve after timeout so subsequent push queues normally', async () => {
      const q = new EventQueue<number>();
      await q.tryDequeue(10); // times out, clears resolve
      q.push(1);
      expect(await q.dequeue()).toBe(1);
    });
  });
});
