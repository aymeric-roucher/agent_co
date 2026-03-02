import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  type WASocket,
} from '@whiskeysockets/baileys';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

export { DisconnectReason, type WASocket };

// ---------- Type guards / helpers ----------

/** Type guard for @hapi/boom errors (avoids `(err as Boom)` casts per CLAUDE.md). */
export function isBoomError(err: unknown): err is Error & { output: { statusCode: number } } {
  if (!(err instanceof Error)) return false;
  const rec = err as unknown as Record<string, unknown>;
  return (
    typeof rec.output === 'object' &&
    rec.output !== null &&
    typeof (rec.output as Record<string, unknown>).statusCode === 'number'
  );
}

/** Safely extract disconnect status code from a lastDisconnect error. */
export function getStatusCode(err: unknown): number | undefined {
  if (isBoomError(err)) return err.output.statusCode;
  return undefined;
}

/** Consistent error formatting for logging. */
export function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---------- Auth helpers ----------

/** Check whether stored WhatsApp credentials exist. */
export function webAuthExists(authDir: string): boolean {
  return existsSync(path.join(authDir, 'creds.json'));
}

/** Read the stored JID from creds.json without connecting. */
export function readWebSelfId(authDir: string): string | null {
  const credsPath = path.join(authDir, 'creds.json');
  if (!existsSync(credsPath)) return null;
  try {
    const creds = JSON.parse(readFileSync(credsPath, 'utf-8'));
    return creds.me?.id ?? null;
  } catch {
    return null;
  }
}

// ---------- Socket lifecycle ----------

/** Create a Baileys socket with multi-file auth state. */
export async function createWaSocket(authDir: string): Promise<{ sock: WASocket; saveCreds: () => Promise<void> }> {
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ version, auth: state });
  sock.ev.on('creds.update', saveCreds);
  return { sock, saveCreds };
}

/** Promise that resolves when the socket's connection reaches 'open'. */
export function waitForWaConnection(sock: WASocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = (update: { connection?: string; lastDisconnect?: { error?: unknown } }) => {
      if (update.connection === 'open') {
        sock.ev.off('connection.update', handler);
        resolve();
      }
      if (update.connection === 'close') {
        sock.ev.off('connection.update', handler);
        const code = getStatusCode(update.lastDisconnect?.error);
        reject(new Error(`Connection closed (status ${code ?? 'unknown'})`));
      }
    };
    sock.ev.on('connection.update', handler);
  });
}

/** Safely close a socket. */
export function closeSocket(sock: WASocket | null): void {
  if (!sock) return;
  try {
    sock.end(undefined);
  } catch {
    // Socket may already be closed — ignore.
  }
}
