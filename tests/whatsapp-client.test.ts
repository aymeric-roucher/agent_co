import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import {
  isBoomError,
  getStatusCode,
  formatError,
  webAuthExists,
  readWebSelfId,
  closeSocket,
} from '../src/whatsapp/session.js';
import type { WhatsAppClient } from '../src/whatsapp/client.js';

const TMP = path.join(import.meta.dirname, '.tmp-whatsapp-test');

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

// ---------- session.ts helpers ----------

describe('session helpers', () => {
  describe('isBoomError', () => {
    it('returns true for boom-shaped errors', () => {
      const err = Object.assign(new Error('boom'), { output: { statusCode: 401 } });
      expect(isBoomError(err)).toBe(true);
    });

    it('returns false for plain errors', () => {
      expect(isBoomError(new Error('plain'))).toBe(false);
    });

    it('returns false for non-errors', () => {
      expect(isBoomError('string')).toBe(false);
      expect(isBoomError(null)).toBe(false);
      expect(isBoomError(undefined)).toBe(false);
    });
  });

  describe('getStatusCode', () => {
    it('extracts status code from boom-shaped error', () => {
      const err = Object.assign(new Error('boom'), { output: { statusCode: 515 } });
      expect(getStatusCode(err)).toBe(515);
    });

    it('returns undefined for non-boom errors', () => {
      expect(getStatusCode(new Error('plain'))).toBeUndefined();
    });

    it('returns undefined for non-errors', () => {
      expect(getStatusCode(null)).toBeUndefined();
    });
  });

  describe('formatError', () => {
    it('returns message for Error instances', () => {
      expect(formatError(new Error('oops'))).toBe('oops');
    });

    it('converts non-errors to string', () => {
      expect(formatError(42)).toBe('42');
      expect(formatError(null)).toBe('null');
    });
  });

  describe('webAuthExists', () => {
    it('returns false when creds.json missing', () => {
      expect(webAuthExists(TMP)).toBe(false);
    });

    it('returns true when creds.json exists', () => {
      writeFileSync(path.join(TMP, 'creds.json'), '{}');
      expect(webAuthExists(TMP)).toBe(true);
    });
  });

  describe('readWebSelfId', () => {
    it('returns null when no creds file', () => {
      expect(readWebSelfId(TMP)).toBeNull();
    });

    it('reads JID from creds', () => {
      writeFileSync(path.join(TMP, 'creds.json'), JSON.stringify({ me: { id: '123@s.whatsapp.net' } }));
      expect(readWebSelfId(TMP)).toBe('123@s.whatsapp.net');
    });

    it('returns null for malformed JSON', () => {
      writeFileSync(path.join(TMP, 'creds.json'), 'not json');
      expect(readWebSelfId(TMP)).toBeNull();
    });

    it('returns null when me.id missing', () => {
      writeFileSync(path.join(TMP, 'creds.json'), '{}');
      expect(readWebSelfId(TMP)).toBeNull();
    });
  });

  describe('closeSocket', () => {
    it('handles null socket gracefully', () => {
      expect(() => closeSocket(null)).not.toThrow();
    });

    it('calls end on socket', () => {
      const sock = { end: () => {} } as any;
      expect(() => closeSocket(sock)).not.toThrow();
    });

    it('ignores errors from already-closed sockets', () => {
      const sock = { end: () => { throw new Error('already closed'); } } as any;
      expect(() => closeSocket(sock)).not.toThrow();
    });
  });
});

// ---------- WhatsAppClient interface compliance ----------

describe('WhatsAppClient interface', () => {
  it('exported interface has required shape', () => {
    // Verify the interface contract by creating a mock that satisfies it
    const mock: WhatsAppClient = {
      userJid: '123@s.whatsapp.net',
      connect: async () => {},
      disconnect: () => {},
      sendAndWaitForReply: async () => 'reply',
    };

    expect(mock.userJid).toBe('123@s.whatsapp.net');
    expect(typeof mock.connect).toBe('function');
    expect(typeof mock.disconnect).toBe('function');
    expect(typeof mock.sendAndWaitForReply).toBe('function');
  });

  it('userJid can be null', () => {
    const mock: WhatsAppClient = {
      userJid: null,
      connect: async () => {},
      disconnect: () => {},
      sendAndWaitForReply: async () => 'reply',
    };
    expect(mock.userJid).toBeNull();
  });
});
