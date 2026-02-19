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

  it('uses default model gpt-5-mini', () => {
    const client = new CodexMCPClient();
    expect((client as any).model).toBe('gpt-5-mini');
  });

  it('accepts custom model and log function', () => {
    const logs: string[] = [];
    const client = new CodexMCPClient('custom-model', (msg) => logs.push(msg));
    expect((client as any).model).toBe('custom-model');
  });
});
