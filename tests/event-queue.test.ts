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
});
