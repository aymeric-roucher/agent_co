import {
  createWaSocket,
  closeSocket,
  getStatusCode,
  DisconnectReason,
  type WASocket,
} from './session.js';

export interface WhatsAppClient {
  userJid: string | null;
  connect(): Promise<void>;
  disconnect(): void;
  sendAndWaitForReply(jid: string, message: string, timeoutMs: number): Promise<string>;
}

// ---------- Internal state ----------

interface ConnectionState {
  sock: WASocket | null;
  connected: boolean;
  userJid: string | null;
  userLid: string | null;
  reconnectAttempts: number;
  lastConnectedAt: number;
  aborted: boolean;
}

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 2000;

/** Compare a remoteJid like "99192471040217@lid" against a full LID like "99192471040217:46@lid". */
function jidMatchesLid(remoteJid: string, lid: string): boolean {
  // Strip device suffix (":NN") from LID for comparison
  const lidBase = lid.replace(/:\d+@/, '@');
  return remoteJid === lidBase || remoteJid === lid;
}

// ---------- Factory ----------

export async function createWhatsAppClient(authDir: string): Promise<WhatsAppClient> {
  const cs: ConnectionState = {
    sock: null,
    connected: false,
    userJid: null,
    userLid: null,
    reconnectAttempts: 0,
    lastConnectedAt: 0,
    aborted: false,
  };

  // Pending reply for sendAndWaitForReply (single at a time)
  let pendingReply: {
    jid: string;
    sentMsgId: string | null;
    resolve: (msg: string) => void;
    reject: (err: Error) => void;
  } | null = null;

  // --- message listener (installed once per socket) ---
  function installMessageListener(sock: WASocket): void {
    sock.ev.on('messages.upsert', ({ messages }) => {
      if (!pendingReply) return;
      for (const msg of messages) {
        // Skip the echo of our own outgoing message
        if (msg.key.id === pendingReply.sentMsgId) continue;

        // Accept messages from the target JID or the user's own LID
        // (self-chat replies arrive as fromMe=true on the user's @lid JID)
        const remoteJid = msg.key.remoteJid ?? '';
        const isTargetChat = remoteJid === pendingReply.jid
          || (cs.userLid && jidMatchesLid(remoteJid, cs.userLid));

        if (!isTargetChat) continue;

        const text = msg.message?.conversation
          ?? msg.message?.extendedTextMessage?.text
          ?? '';
        if (text) {
          pendingReply.resolve(text);
          pendingReply = null;
          return;
        }
      }
    });
  }

  // --- reconnection monitor ---
  function installReconnectionMonitor(sock: WASocket): void {
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'open') {
        cs.connected = true;
        cs.userJid = sock.user?.id ?? null;
        cs.userLid = (sock.user as Record<string, unknown>)?.lid as string ?? null;
        cs.reconnectAttempts = 0;
        cs.lastConnectedAt = Date.now();
      }

      if (connection === 'close') {
        cs.connected = false;
        if (cs.aborted) return;

        const code = getStatusCode(lastDisconnect?.error);

        // Don't reconnect on explicit logout
        if (code === DisconnectReason.loggedOut || code === 401) {
          rejectPending(new Error('WhatsApp session expired. Re-run `vp whatsapp-login`.'));
          return;
        }

        // Attempt auto-reconnect for transient failures (including 515 restart)
        if (cs.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          cs.reconnectAttempts++;
          setTimeout(() => {
            if (cs.aborted) return;
            reconnect(authDir).catch(() => {
              rejectPending(new Error('WhatsApp reconnection failed'));
            });
          }, RECONNECT_DELAY_MS);
        } else {
          rejectPending(new Error('WhatsApp disconnected after max reconnection attempts'));
        }
      }
    });
  }

  function rejectPending(err: Error): void {
    if (pendingReply) {
      pendingReply.reject(err);
      pendingReply = null;
    }
  }

  async function reconnect(dir: string): Promise<void> {
    closeSocket(cs.sock);
    const { sock } = await createWaSocket(dir);
    cs.sock = sock;
    installMessageListener(sock);
    installReconnectionMonitor(sock);
  }

  // --- public methods ---

  async function connect(): Promise<void> {
    const { sock } = await createWaSocket(authDir);
    cs.sock = sock;
    installMessageListener(sock);

    return new Promise<void>((resolve, reject) => {
      sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
          cs.connected = true;
          cs.userJid = sock.user?.id ?? null;
          cs.userLid = (sock.user as Record<string, unknown>)?.lid as string ?? null;
          cs.reconnectAttempts = 0;
          cs.lastConnectedAt = Date.now();
          // Install reconnection monitor now that initial connect succeeded
          installReconnectionMonitor(sock);
          resolve();
        }
        if (connection === 'close') {
          const code = getStatusCode(lastDisconnect?.error);

          // 515 = restart required — try once during initial connect
          if (code === DisconnectReason.restartRequired && cs.reconnectAttempts === 0) {
            cs.reconnectAttempts++;
            reconnect(authDir).then(() => {
              // Wait for the reconnected socket to reach 'open'
              const reconSock = cs.sock!;
              reconSock.ev.on('connection.update', (u) => {
                if (u.connection === 'open') {
                  cs.connected = true;
                  cs.userJid = reconSock.user?.id ?? null;
                  cs.userLid = (reconSock.user as Record<string, unknown>)?.lid as string ?? null;
                  cs.reconnectAttempts = 0;
                  cs.lastConnectedAt = Date.now();
                  installReconnectionMonitor(reconSock);
                  resolve();
                }
              });
            }).catch(reject);
            return;
          }

          reject(new Error(
            code === DisconnectReason.loggedOut || code === 401
              ? 'WhatsApp session expired. Re-run `vp whatsapp-login`.'
              : `WhatsApp connection closed (status ${code ?? 'unknown'})`,
          ));
        }
      });
    });
  }

  function disconnect(): void {
    cs.aborted = true;
    closeSocket(cs.sock);
    cs.sock = null;
    cs.connected = false;
    rejectPending(new Error('WhatsApp disconnected'));
  }

  async function sendAndWaitForReply(jid: string, message: string, timeoutMs: number): Promise<string> {
    if (!cs.sock || !cs.connected) throw new Error('WhatsApp not connected');

    const sent = await cs.sock.sendMessage(jid, { text: message });
    const sentMsgId = sent?.key?.id ?? null;

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingReply = null;
        reject(new Error(`No reply within ${Math.round(timeoutMs / 60_000)} minutes`));
      }, timeoutMs);

      pendingReply = {
        jid,
        sentMsgId,
        resolve: (msg: string) => {
          clearTimeout(timer);
          resolve(msg);
        },
        reject: (err: Error) => {
          clearTimeout(timer);
          reject(err);
        },
      };
    });
  }

  return {
    get userJid() { return cs.userJid; },
    connect,
    disconnect,
    sendAndWaitForReply,
  };
}
