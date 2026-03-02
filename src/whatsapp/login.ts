import { mkdirSync } from 'fs';
import qrTerminal from 'qrcode-terminal';
import {
  createWaSocket,
  closeSocket,
  getStatusCode,
  DisconnectReason,
  type WASocket,
} from './session.js';

// ---------- ActiveLogin state machine ----------

interface ActiveLogin {
  authDir: string;
  sock: WASocket;
  startedAt: number;
  qr: string | null;
  connected: boolean;
  error: string | null;
  errorStatus: number | undefined;
  restartAttempted: boolean;
}

const ACTIVE_LOGIN_TTL_MS = 3 * 60_000;

function resetActiveLogin(login: ActiveLogin): void {
  login.qr = null;
  login.connected = false;
  login.error = null;
  login.errorStatus = undefined;
}

function isLoginFresh(login: ActiveLogin): boolean {
  return Date.now() - login.startedAt < ACTIVE_LOGIN_TTL_MS;
}

// ---------- Connection event handler ----------

function attachLoginWaiter(login: ActiveLogin): void {
  login.sock.ev.on('connection.update', (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      login.qr = qr;
      console.log('Scan this QR code with WhatsApp on your phone:');
      qrTerminal.generate(qr, { small: true });
    }

    if (connection === 'open') {
      login.connected = true;
    }

    if (connection === 'close') {
      const code = getStatusCode(lastDisconnect?.error);
      login.errorStatus = code;

      // 515 = stream restart required — try once
      if (code === DisconnectReason.restartRequired && !login.restartAttempted) {
        login.restartAttempted = true;
        restartLoginSocket(login).catch((err) => {
          login.error = err instanceof Error ? err.message : String(err);
        });
        return;
      }

      login.error = `Connection closed (status ${code ?? 'unknown'})`;
    }
  });
}

async function restartLoginSocket(login: ActiveLogin): Promise<void> {
  closeSocket(login.sock);
  const { sock } = await createWaSocket(login.authDir);
  login.sock = sock;
  attachLoginWaiter(login);
}

// ---------- Public API ----------

export async function whatsappLogin(authDir: string): Promise<void> {
  mkdirSync(authDir, { recursive: true });

  const { sock } = await createWaSocket(authDir);

  const login: ActiveLogin = {
    authDir,
    sock,
    startedAt: Date.now(),
    qr: null,
    connected: false,
    error: null,
    errorStatus: undefined,
    restartAttempted: false,
  };

  attachLoginWaiter(login);

  // Poll until connected, errored, or timed out
  while (!login.connected && !login.error && isLoginFresh(login)) {
    await new Promise((r) => setTimeout(r, 500));
  }

  if (login.connected) {
    console.log(`WhatsApp logged in as ${login.sock.user?.id}`);
    closeSocket(login.sock);
    return;
  }

  closeSocket(login.sock);
  throw new Error(login.error ?? 'WhatsApp login timed out.');
}
