import { describe, it, expect } from 'vitest';
import { CodexMCPClient } from '../src/workers/mcp-client.js';

describe('CodexMCPClient', () => {
  it('exports a class with the expected methods', () => {
    const client = new CodexMCPClient();
    expect(typeof client.connect).toBe('function');
    expect(typeof client.startSession).toBe('function');
    expect(typeof client.continueSession).toBe('function');
    expect(typeof client.close).toBe('function');
  });
});
