import express from 'express';
import QRCode from 'qrcode';
import pino from 'pino';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';

const app = express();
app.use(express.json({ limit: '32kb' }));
const port = Number(process.env.PORT || 3000);
const token = process.env.ZETAMAX_WORKER_TOKEN || '';
const sessionRoot = process.env.SESSION_DIR || '/data/sessions';
const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });
const sessions = new Map();
const safeId = (id) => String(id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
const requireToken = (req, res, next) => {
  if (!token || req.headers.authorization !== `Bearer ${token}`) return res.status(401).json({ error: 'Unauthorized worker request.' });
  next();
};
const snapshot = (id) => {
  const current = sessions.get(id);
  return { botId: id, status: current?.status || 'Needs Pairing', qrDataUrl: current?.qrDataUrl || null, updatedAt: current?.updatedAt || Date.now() };
};
async function startSession(botId) {
  const id = safeId(botId);
  if (!id) throw new Error('Invalid bot ID.');
  const existing = sessions.get(id);
  if (existing?.status === 'Connected') return snapshot(id);
  if (existing?.starting) return snapshot(id);
  if (existing?.sock) {
    try { existing.sock.end(undefined); } catch {}
  }
  const state = { status: 'Connecting', qrDataUrl: null, updatedAt: Date.now(), starting: true, sock: null };
  sessions.set(id, state);
  await fs.mkdir(path.join(sessionRoot, id), { recursive: true });
  const { state: auth, saveCreds } = await useMultiFileAuthState(path.join(sessionRoot, id));
  const sock = makeWASocket({ auth, logger, printQRInTerminal: false, browser: ['ZETAMAX', 'Chrome', '1.0.0'], markOnlineOnConnect: false, syncFullHistory: false });
  state.sock = sock;
  state.starting = false;
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async (update) => {
    state.updatedAt = Date.now();
    if (update.qr) {
      state.status = 'Needs Pairing';
      try { state.qrDataUrl = await QRCode.toDataURL(update.qr, { width: 280, margin: 2 }); } catch (e) { logger.error(e); }
    }
    if (update.connection === 'open') {
      state.status = 'Connected';
      state.qrDataUrl = null;
    }
    if (update.connection === 'close') {
      state.qrDataUrl = null;
      const code = update.lastDisconnect?.error?.output?.statusCode;
      state.status = code === DisconnectReason.loggedOut ? 'Logged Out' : 'Disconnected';
      state.sock = null;
    }
  });
  return snapshot(id);
}
app.get('/health', (_req, res) => res.json({ ok: true, service: 'ZETAMAX WhatsApp worker', activeSessions: sessions.size }));
app.get('/bots/:botId/pairing', requireToken, (req, res) => {
  const id = safeId(req.params.botId);
  if (!id) return res.status(400).json({ error: 'Invalid bot ID.' });
  res.json(snapshot(id));
});
app.post('/bots/:botId/action', requireToken, async (req, res) => {
  const id = safeId(req.params.botId);
  const action = String(req.body?.action || '');
  if (!id) return res.status(400).json({ error: 'Invalid bot ID.' });
  try {
    if (action === 'pair' || action === 'start' || action === 'restart') {
      const result = await startSession(id);
      return res.status(202).json({ ok: true, ...result, message: 'Pairing request accepted. Poll the pairing endpoint for a real QR or connection status.' });
    }
    if (action === 'stop') {
      const state = sessions.get(id);
      if (state?.sock) { try { state.sock.end(undefined); } catch {} }
      sessions.set(id, { status: 'Stopped', qrDataUrl: null, updatedAt: Date.now(), sock: null, starting: false });
      return res.json({ ok: true, ...snapshot(id), message: 'Worker socket stopped. Saved credentials were preserved.' });
    }
    return res.status(400).json({ error: 'Unsupported action.' });
  } catch (e) {
    logger.error({ err: e, botId: id }, 'WhatsApp session action failed');
    return res.status(500).json({ error: 'Could not start the WhatsApp session. Check worker logs.' });
  }
});
app.listen(port, '0.0.0.0', () => {
  if (!token) logger.error('ZETAMAX_WORKER_TOKEN is missing; authenticated requests will fail.');
  logger.info({ port, sessionRoot }, 'ZETAMAX worker listening');
  void restoreSessions();
});

async function restoreSessions() {
  try {
    await fs.mkdir(sessionRoot, { recursive: true });
    const entries = await fs.readdir(sessionRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !safeId(entry.name)) continue;
      try {
        await startSession(entry.name);
        logger.info({ botId: entry.name }, 'Restored persistent WhatsApp session');
      } catch (err) {
        logger.error({ err, botId: entry.name }, 'Could not restore WhatsApp session');
      }
    }
  } catch (err) {
    logger.error({ err, sessionRoot }, 'Could not inspect persistent session directory');
  }
}
