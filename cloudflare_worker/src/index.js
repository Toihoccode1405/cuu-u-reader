import JSZip from 'jszip';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function errorResponse(msg, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// -----------------------------------------------------------------------------
// CRYPTO HELPERS (WEB CRYPTO API)
// -----------------------------------------------------------------------------

async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: enc.encode(salt),
      iterations: 50000,
      hash: 'SHA-256',
    },
    key,
    256
  );
  return Array.from(new Uint8Array(bits))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

const DEFAULT_JWT_SECRET = 'REDACTED_SECRET';

function getJwtSecret(env) {
  return env?.JWT_SECRET || DEFAULT_JWT_SECRET;
}

const MAX_TOKEN_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const failedLogins = new Map(); // username -> { count: number, resetAt: number }

function checkLoginRateLimit(username) {
  const now = Date.now();
  const record = failedLogins.get(username);
  if (record && now < record.resetAt && record.count >= 5) {
    return false;
  }
  return true;
}

function recordLoginFailure(username) {
  const now = Date.now();
  const record = failedLogins.get(username);
  if (!record || now >= record.resetAt) {
    failedLogins.set(username, { count: 1, resetAt: now + 5 * 60 * 1000 });
  } else {
    record.count += 1;
  }
}

function clearLoginFailure(username) {
  failedLogins.delete(username);
}

async function generateToken(userId, username, secret = DEFAULT_JWT_SECRET) {
  const payload = `${userId}:${username}:${Date.now()}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const sigHex = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return btoa(`${payload}:${sigHex}`);
}

async function verifyToken(token, secret = DEFAULT_JWT_SECRET) {
  try {
    const raw = atob(token);
    const parts = raw.split(':');
    if (parts.length !== 4) return null;
    const [userId, username, ts, sigHex] = parts;
    const timestamp = parseInt(ts, 10);
    if (!Number.isFinite(timestamp)) return null;

    // Check token expiration (30 days) and prevent future timestamps
    const now = Date.now();
    if (now - timestamp > MAX_TOKEN_AGE_MS || timestamp > now + 60000) {
      return null;
    }

    const payload = `${userId}:${username}:${ts}`;

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const sigBytes = new Uint8Array(sigHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payload));
    if (!valid) return null;

    return { userId, username };
  } catch (e) {
    return null;
  }
}


// -----------------------------------------------------------------------------
// EDGE TTS — Microsoft Edge Read Aloud (free, multiple voices)
// Ported from cloudflare-edge-tts (DIYgod/cloudflare-edge-tts)
// -----------------------------------------------------------------------------

const EDGE_TTS_READALOUD_BASE = 'speech.platform.bing.com/consumer/speech/synthesize/readaloud';
const EDGE_TTS_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const EDGE_TTS_VOICE_LIST_URL = `https://${EDGE_TTS_READALOUD_BASE}/voices/list?trustedclienttoken=${EDGE_TTS_TOKEN}`;
const EDGE_TTS_SYNTHESIS_URL = `https://${EDGE_TTS_READALOUD_BASE}/edge/v1`;
const EDGE_CHROMIUM_VER = '143.0.3650.75';
const EDGE_CHROMIUM_MAJOR = EDGE_CHROMIUM_VER.split('.')[0];
const EDGE_GEC_VERSION = `2-${EDGE_CHROMIUM_VER}`;

const EDGE_BASE_HEADERS = {
  'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${EDGE_CHROMIUM_MAJOR}.0.0.0 Safari/537.36 Edg/${EDGE_CHROMIUM_MAJOR}.0.0.0`,
  'Accept-Language': 'en-US,en;q=0.9',
};

const EDGE_UPGRADE_HEADERS = {
  ...EDGE_BASE_HEADERS,
  'Accept-Encoding': 'gzip, deflate, br, zstd',
  Pragma: 'no-cache',
  'Cache-Control': 'no-cache',
  'Sec-WebSocket-Version': '13',
  Upgrade: 'websocket',
};

const EDGE_VOICE_HEADERS = {
  ...EDGE_BASE_HEADERS,
  Authority: 'speech.platform.bing.com',
  'Sec-CH-UA': `" Not;A Brand";v="99", "Microsoft Edge";v="${EDGE_CHROMIUM_MAJOR}", "Chromium";v="${EDGE_CHROMIUM_MAJOR}"`,
  'Sec-CH-UA-Mobile': '?0',
  Accept: '*/*',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
};

// --- Sec-MS-GEC v2 token generation (ported from edge-tts drm.py) ---

const WIN_EPOCH_SECONDS = 11644473600;
const TOKEN_WINDOW_SECONDS = 300;

const SHA256_INITIAL = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const SHA256_PREFIX_STATE = [0xfd9fbea2, 0x91243ce7, 0xbe499094, 0xcd2e1e0a, 0x6c006f49, 0x04bd35ab, 0xfeb0a7e4, 0x03effbd2];
const SHA256_PREFIX_SCHEDULE = [0xeb24bf9e, 0x1558691f, 0xa0c09ee2, 0x0cfa32ba, 0xa622ee8c, 0xd1dd9491, 0xc0dd25a0, 0xf9e70ab6, 0xf0c31573, 0x7058ce4e, 0x7188e606, 0x00e5ab33, 0xd258b060, 0x72766564];
const SHA256_ROUND_CONSTANTS = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
const SHA256_ROUND_14_ADJUSTMENT = 0xc9dc06a7;
const SHA256_PREFIX_BLOCK_CONSTANTS = SHA256_ROUND_CONSTANTS.map((c, i) => i === 14 ? SHA256_ROUND_14_ADJUSTMENT : c);
const SHA256_SIGMA0_ADJUSTMENT = 0x059c0b80;
const SHA256_SIGMA1_ADJUSTMENT = 0x000b92c0;

const CS64_COEFFICIENTS = [[0xe82e91b1,0xb32700d0],[0x44de24c6,0x88dff51d],[0x3beb65bc,0x29514038],[0xc89c5933,0xb328cbdf],[0x8d1ec211,0xd405b4d5],[0x314ef5d5,0x26e55f3c],[0xe92491b1,0x607801c6],[0xf0a5b9d5,0x82b2c1fb],[0x06064cf3,0xfa51a3da],[0xda79fa60,0x207cc464],[0xbed20560,0x3c3c74f3],[0x89f9c9f8,0xd2d14b61],[0x35fa38c6,0xbb04a2c1],[0xcb49e3c6,0xc5626167]];
const CS64_FACTOR = 0x82893933;
const CS64_ADJUSTMENT0 = 0xf2f90b1a;
const CS64_ADJUSTMENT1 = 0x0b1a0000;

function gecRotr(v, b) { return ((v >>> b) | (v << (32 - b))) >>> 0; }
function gecRol16(v) { return ((v << 16) | (v >>> 16)) >>> 0; }
function gecSigma0(v) { return (gecRotr(v, 7) ^ gecRotr(v, 18) ^ (v >>> 3)) >>> 0; }
function gecSigma1(v) { return (gecRotr(v, 17) ^ gecRotr(v, 19) ^ (v >>> 10)) >>> 0; }

function gecExpandSchedule(words, first = 16) {
  for (let i = first; i < 64; i++) {
    words[i] = (gecSigma1(words[i - 2]) + words[i - 7] + gecSigma0(words[i - 15]) + words[i - 16]) >>> 0;
  }
}

function gecCompress(state, words, firstRound = 0) {
  const K = firstRound === 14 ? SHA256_PREFIX_BLOCK_CONSTANTS : SHA256_ROUND_CONSTANTS;
  let [a, b, c, d, e, f, g, h] = state;
  for (let i = firstRound; i < 64; i++) {
    const t1 = (h + (gecRotr(e, 6) ^ gecRotr(e, 11) ^ gecRotr(e, 25)) + (g ^ (e & (f ^ g))) + K[i] + words[i]) >>> 0;
    const t2 = ((gecRotr(a, 2) ^ gecRotr(a, 13) ^ gecRotr(a, 22)) + ((a & b) | (c & (a | b)))) >>> 0;
    h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
  }
  return [a, b, c, d, e, f, g, h];
}

function gecPrefixBlockState(payload) {
  const words = new Array(14).fill(0);
  words.push((payload[0] << 16) | (payload[1] << 8) | payload[2]);
  words.push(((payload[3] << 24) | (payload[4] << 16) | (payload[5] << 8) | payload[6]) >>> 0);
  for (let i = 16; i < 30; i++) {
    let v = SHA256_PREFIX_SCHEDULE[i - 16] + (i === 16 ? (gecSigma1(words[14]) ^ SHA256_SIGMA1_ADJUSTMENT) >>> 0 : gecSigma1(words[i - 2]));
    if (i >= 21) v += words[i - 7];
    if (i === 29) v += (gecSigma0(words[14]) ^ SHA256_SIGMA0_ADJUSTMENT) >>> 0;
    words.push(v >>> 0);
  }
  words.push((gecSigma1(words[28]) + words[23] + gecSigma0(words[15]) + words[14] + SHA256_ROUND_14_ADJUSTMENT - SHA256_ROUND_CONSTANTS[14]) >>> 0);
  gecExpandSchedule(words, 31);
  const working = gecCompress(SHA256_PREFIX_STATE, words, 14);
  return SHA256_INITIAL.map((v, i) => (v + working[i]) >>> 0);
}

function gecSha256(payload) {
  if (payload.length < 7) throw new Error('payload too short');
  const msgLen = 57 + payload.length;
  const zeroPad = (((55 - msgLen) % 64) + 64) % 64;
  const tail = new Uint8Array(payload.length - 7 + 1 + zeroPad + 8);
  tail.set(payload.subarray(7));
  tail[payload.length - 7] = 0x80;
  const tv = new DataView(tail.buffer);
  const bitLen = msgLen * 8;
  tv.setUint32(tail.length - 8, Math.floor(bitLen / 2 ** 32));
  tv.setUint32(tail.length - 4, bitLen >>> 0);
  let state = gecPrefixBlockState(payload);
  for (let off = 0; off < tail.length; off += 64) {
    const w = [];
    for (let i = 0; i < 16; i++) w.push(tv.getUint32(off + i * 4));
    gecExpandSchedule(w);
    const working = gecCompress(state, w);
    state = state.map((v, i) => (v + working[i]) >>> 0);
  }
  const digest = new Uint8Array(32);
  const dv = new DataView(digest.buffer);
  state.forEach((v, i) => dv.setUint32(i * 4, v));
  return digest;
}

function gecCs64Words(payload) {
  const byteLen = Math.ceil((payload.length + 1) / 8) * 8;
  const bytes = new Uint8Array(byteLen);
  bytes.set(payload, 1);
  const view = new DataView(bytes.buffer);
  const words = [];
  for (let off = 0; off < byteLen; off += 4) words.push(view.getUint32(off, true));
  return words;
}

function gecCs64(payload, digest) {
  const dv = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);
  const kA = (dv.getUint32(0, true) | 1) >>> 0;
  const kB = (dv.getUint32(4, true) | 1) >>> 0;
  const factors = [Math.imul(kA, CS64_FACTOR) >>> 0, Math.imul(kB, CS64_FACTOR) >>> 0];
  const terms = CS64_COEFFICIENTS.map(([c], i) => Math.imul(c, factors[i % 2]) >>> 0);
  const offsets = CS64_COEFFICIENTS.map(([, o]) => o);
  gecCs64Words(payload).forEach((word, idx) => {
    const even = idx % 2 === 0;
    let term = Math.imul(word, even ? kA : kB);
    let offset = Math.imul(gecRol16(word), even ? 0xef0569fb : 0xc31713db);
    if (idx === 0) { term += Math.imul(CS64_ADJUSTMENT0, factors[0]); offset += CS64_ADJUSTMENT1; }
    terms.push(term >>> 0);
    offsets.push(offset >>> 0);
  });
  let swapAcc = 0, swapLast = 0, state = 0, acc = 0;
  for (let i = 0; i < terms.length; i += 2) {
    let q = Math.imul(gecRol16((offsets[i] + terms[i]) >>> 0), 0x76f50f34) >>> 0;
    swapAcc = (swapAcc + Math.imul(gecRol16(q), 0xc3efea97) + q) >>> 0;
    q = Math.imul(gecRol16((offsets[i + 1] + terms[i + 1]) >>> 0), 0x1881ce3c) >>> 0;
    swapLast = (Math.imul(gecRol16(q), 0x35bd1ec9) + q) >>> 0;
    swapAcc = (swapAcc + swapLast) >>> 0;
    state = (Math.imul(state, kA) + terms[i]) >>> 0;
    state = Math.imul(gecRol16(state), 0xcf98b111) >>> 0;
    state = Math.imul(gecRol16(state), 0x87085b9f) >>> 0;
    state = Math.imul(gecRol16(state), 0x12ceb96d) >>> 0;
    state = Math.imul(gecRol16(state), 0x257e1d83) >>> 0;
    acc = (acc + state) >>> 0;
    let t = (Math.imul(state, kB) + terms[i + 1]) >>> 0;
    t = Math.imul(gecRol16(t), 0xa27416f5) >>> 0;
    t = Math.imul(gecRol16(t), 0xd38396ff) >>> 0;
    t = Math.imul(gecRol16(t), 0x7c932b89) >>> 0;
    state = Math.imul(gecRol16(t), 0xbfa49f69) >>> 0;
    acc = (acc + state) >>> 0;
  }
  return [(swapLast ^ state) >>> 0, (swapAcc ^ acc) >>> 0];
}

function gecToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function generateSecMsGec(token, unixSec = Date.now() / 1000) {
  let ticks = unixSec + WIN_EPOCH_SECONDS;
  ticks -= ticks % TOKEN_WINDOW_SECONDS;
  ticks *= 1e7;
  const payload = `${ticks.toFixed(0)}${token}`;
  const bytes = new TextEncoder().encode(payload);
  const digest = gecSha256(bytes);
  const checksum = new Uint8Array(8);
  const cv = new DataView(checksum.buffer);
  gecCs64(bytes, digest).forEach((w, i) => cv.setUint32(i * 4, w, true));
  return `${gecToHex(checksum)}-${gecToHex(digest)}`;
}

// --- Edge TTS synthesis helpers ---

function edgeTtsEscapeXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function edgeTtsCleanXml(text) {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ' ');
}

function edgeTtsTimestamp() {
  return new Date().toISOString().replace(/[-:.]/g, '').slice(0, -1);
}

function edgeTtsBuildSsml(requestId, voice, text) {
  const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${voice}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>${edgeTtsEscapeXml(edgeTtsCleanXml(text))}</prosody></voice></speak>`;
  return `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${edgeTtsTimestamp()}Z\r\nPath:ssml\r\n\r\n${ssml}`;
}

function edgeTtsBuildConfig() {
  return `X-Timestamp:${edgeTtsTimestamp()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`;
}

function edgeTtsParseBinaryFrame(data) {
  if (data.length < 2) throw new Error('frame too short');
  const hLen = (data[0] << 8) | data[1];
  if (data.length < 2 + hLen) throw new Error('frame truncated');
  const headerText = new TextDecoder().decode(data.slice(2, 2 + hLen));
  const headers = {};
  for (const line of headerText.split('\r\n')) {
    const col = line.indexOf(':');
    if (col > 0) headers[line.slice(0, col)] = line.slice(col + 1).trim();
  }
  return { headers, body: data.slice(2 + hLen) };
}

function edgeTtsParseTextHeaders(msg) {
  const sep = msg.indexOf('\r\n\r\n');
  const hdr = sep >= 0 ? msg.slice(0, sep) : msg;
  const headers = {};
  for (const line of hdr.split('\r\n')) {
    const col = line.indexOf(':');
    if (col > 0) headers[line.slice(0, col)] = line.slice(col + 1).trim();
  }
  return headers;
}

async function edgeTtsSynthesize(text, voice) {
  const secMsGec = generateSecMsGec(EDGE_TTS_TOKEN);
  const connectionId = crypto.randomUUID().replace(/-/g, '');
  const requestId = crypto.randomUUID().replace(/-/g, '');
  const muidBytes = new Uint8Array(16);
  crypto.getRandomValues(muidBytes);
  const muid = Array.from(muidBytes).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

  const wsUrl = new URL(EDGE_TTS_SYNTHESIS_URL);
  wsUrl.searchParams.set('TrustedClientToken', EDGE_TTS_TOKEN);
  wsUrl.searchParams.set('Sec-MS-GEC', secMsGec);
  wsUrl.searchParams.set('Sec-MS-GEC-Version', EDGE_GEC_VERSION);
  wsUrl.searchParams.set('ConnectionId', connectionId);

  const resp = await fetch(wsUrl.toString(), {
    headers: { ...EDGE_UPGRADE_HEADERS, Cookie: `muid=${muid};` },
  });

  if (resp.status !== 101 || !resp.webSocket) {
    throw new Error(`WebSocket upgrade failed: ${resp.status}`);
  }

  const ws = resp.webSocket;
  ws.accept();

  return new Promise((resolve, reject) => {
    const audioChunks = [];
    let done = false;
    const timeout = setTimeout(() => {
      if (!done) { done = true; try { ws.close(); } catch {} reject(new Error('Edge TTS timeout')); }
    }, 30000);

    ws.addEventListener('message', (event) => {
      if (done) return;
      const data = event.data;
      if (typeof data === 'string') {
        const headers = edgeTtsParseTextHeaders(data);
        if (headers.Path === 'turn.end') {
          done = true; clearTimeout(timeout);
          try { ws.close(); } catch {}
          if (audioChunks.length === 0) { reject(new Error('No audio received')); return; }
          let totalLen = 0;
          for (const c of audioChunks) totalLen += c.length;
          const merged = new Uint8Array(totalLen);
          let off = 0;
          for (const c of audioChunks) { merged.set(c, off); off += c.length; }
          resolve(merged);
        }
        return;
      }
      // Binary data
      try {
        let binary;
        if (data instanceof ArrayBuffer) binary = new Uint8Array(data);
        else if (data instanceof Uint8Array) binary = data;
        else return;
        const { headers, body } = edgeTtsParseBinaryFrame(binary);
        if (headers.Path === 'audio' && body.length > 0) {
          audioChunks.push(body);
        }
      } catch {}
    });

    ws.addEventListener('close', () => {
      if (!done) {
        done = true; clearTimeout(timeout);
        if (audioChunks.length > 0) {
          let totalLen = 0;
          for (const c of audioChunks) totalLen += c.length;
          const merged = new Uint8Array(totalLen);
          let off = 0;
          for (const c of audioChunks) { merged.set(c, off); off += c.length; }
          resolve(merged);
        } else {
          reject(new Error('WebSocket closed without audio'));
        }
      }
    });

    ws.addEventListener('error', (e) => {
      if (!done) { done = true; clearTimeout(timeout); reject(new Error('WebSocket error')); }
    });

    ws.send(edgeTtsBuildConfig());
    ws.send(edgeTtsBuildSsml(requestId, voice, text));
  });
}

async function edgeTtsGetVoices() {
  const secMsGec = generateSecMsGec(EDGE_TTS_TOKEN);
  const url = `${EDGE_TTS_VOICE_LIST_URL}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${EDGE_GEC_VERSION}`;
  const resp = await fetch(url, { headers: EDGE_VOICE_HEADERS });
  if (!resp.ok) throw new Error(`Voice list failed: ${resp.status}`);
  return resp.json();
}

// Vietnamese voices hardcoded for fast frontend access
const EDGE_TTS_VI_VOICES = [
  { id: 'vi-VN-HoaiMyNeural', name: 'HoaiMy', gender: 'Nữ', desc: 'Giọng nữ miền Nam' },
  { id: 'vi-VN-NamMinhNeural', name: 'NamMinh', gender: 'Nam', desc: 'Giọng nam miền Bắc' },
];


// -----------------------------------------------------------------------------
// MAIN WORKER HANDLER
// -----------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }
    const url = new URL(request.url);
    const path = url.pathname;

    // Route static frontend requests (SPA) to Cloudflare Assets
    if (!path.startsWith('/api')) {
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }
      return new Response('Not Found', { status: 404 });
    }

    // Edge TTS — Microsoft voices (no auth required)
    if (path === '/api/edge-tts' && request.method === 'GET') {
      const text = url.searchParams.get('q');
      if (!text) return errorResponse('Missing q parameter');
      const voice = url.searchParams.get('voice') || 'vi-VN-HoaiMyNeural';
      try {
        const audioData = await edgeTtsSynthesize(text, voice);
        return new Response(audioData, {
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'audio/mpeg',
            'Cache-Control': 'public, max-age=86400',
          },
        });
      } catch (e) {
        console.error('Edge TTS error:', e);
        return errorResponse('Edge TTS failed: ' + e.message, 502);
      }
    }

    // Edge TTS voices list
    if (path === '/api/edge-tts/voices' && request.method === 'GET') {
      const lang = url.searchParams.get('lang') || 'vi';
      try {
        const allVoices = await edgeTtsGetVoices();
        const filtered = allVoices
          .filter(v => v.Locale && v.Locale.startsWith(lang))
          .map(v => ({ id: v.ShortName, name: v.ShortName.split('-').pop().replace('Neural', ''), gender: v.Gender === 'Female' ? 'Nữ' : 'Nam', locale: v.Locale }));
        return jsonResponse({ voices: filtered.length > 0 ? filtered : EDGE_TTS_VI_VOICES });
      } catch (e) {
        return jsonResponse({ voices: EDGE_TTS_VI_VOICES });
      }
    }

    // TTS Proxy — Google Translate TTS (no auth required)
    if (path === '/api/tts' && request.method === 'GET') {
      const text = url.searchParams.get('q');
      if (!text) return errorResponse('Missing q parameter');
      const tl = url.searchParams.get('tl') || 'vi';
      const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${encodeURIComponent(tl)}&client=tw-ob`;
      const ttsResp = await fetch(ttsUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      });
      if (!ttsResp.ok) return errorResponse('TTS request failed', ttsResp.status);
      return new Response(ttsResp.body, {
        headers: {
          ...CORS_HEADERS,
          'Content-Type': ttsResp.headers.get('Content-Type') || 'audio/mpeg',
          'Cache-Control': 'public, max-age=86400',
        },
      });
    }

    try {
      if (!env.DB) {
        return errorResponse('Chưa liên kết cơ sở dữ liệu Cloudflare D1', 500);
      }
      await initTables(env.DB);
    // 1. Auth: Register
    if (path === '/api/auth/register' && request.method === 'POST') {
      if (env.ALLOW_REGISTRATION !== 'true') {
        return errorResponse('Hệ thống tạm thời đóng đăng ký tài khoản mới.', 403);
      }
      const { username, password } = await request.json();
      if (!username || !password || username.length < 3 || password.length < 4) {
        return errorResponse('Tài khoản ít nhất 3 ký tự, mật khẩu ít nhất 4 ký tự');
      }

      const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?')
        .bind(username.toLowerCase().trim())
        .first();

      if (existing) {
        return errorResponse('Tên tài khoản này đã được sử dụng');
      }

      const userId = 'u_' + crypto.randomUUID();
      const salt = 'salt_' + userId;
      const hash = await hashPassword(password, salt);

      await env.DB.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
        .bind(userId, username.toLowerCase().trim(), hash, Date.now())
        .run();

      const jwtSecret = getJwtSecret(env);
      const token = await generateToken(userId, username.trim(), jwtSecret);
      return jsonResponse({
        token,
        user: { id: userId, username: username.trim() }
      });
    }

    // 2. Auth: Login
    if (path === '/api/auth/login' && request.method === 'POST') {
      const { username, password } = await request.json();
      const cleanUser = username?.toLowerCase().trim();
      if (!cleanUser || !checkLoginRateLimit(cleanUser)) {
        return errorResponse('Đăng nhập sai quá 5 lần liên tiếp. Vui lòng thử lại sau 5 phút.', 429);
      }

      const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?')
        .bind(cleanUser)
        .first();

      if (!user) {
        recordLoginFailure(cleanUser);
        return errorResponse('Tài khoản hoặc mật khẩu không chính xác');
      }

      const salt = 'salt_' + user.id;
      const hash = await hashPassword(password, salt);

      if (hash !== user.password_hash) {
        recordLoginFailure(cleanUser);
        return errorResponse('Tài khoản hoặc mật khẩu không chính xác');
      }

      clearLoginFailure(cleanUser);
      const jwtSecret = getJwtSecret(env);
      const token = await generateToken(user.id, user.username, jwtSecret);
      return jsonResponse({
        token,
        user: { id: user.id, username: user.username }
      });
    }

    // Auth Middleware for all protected /api/ routes
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '') || url.searchParams.get('token') || '';
    const jwtSecret = getJwtSecret(env);
    const userSession = token ? await verifyToken(token, jwtSecret) : null;
    // Auth: Check me
    if (path === '/api/auth/me' && request.method === 'GET') {
      if (!userSession) return errorResponse('Phiên đăng nhập hết hạn', 401);
      return jsonResponse({ user: userSession });
    }

    if (!userSession && (path.startsWith('/api/books') || path.startsWith('/api/history') || path.startsWith('/api/last-read') || path.startsWith('/api/settings'))) {
      return errorResponse('Chưa đăng nhập. Vui lòng đăng nhập để sử dụng.', 401);
    }

    const userId = userSession?.userId;

    // 3. Books: List books
    if (path === '/api/books' && request.method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT id, title, author, total_chapters, current_chapter, scroll_percent, para_index, has_cover, added_at FROM books WHERE user_id = ? ORDER BY added_at DESC'
      ).bind(userId).all();

      return jsonResponse(results || []);
    }

    // 4. Books: Upload EPUB
    // 4. Books: Upload EPUB (Chunked Zero-Timeout Architecture)
    if (path === '/api/books/upload' && request.method === 'POST') {
      const formData = await request.formData();
      const file = formData.get('file');
      if (!file) return errorResponse('Thiếu file EPUB');
      if (file.size > 50 * 1024 * 1024) {
        return errorResponse('File quá lớn (tối đa 50MB)', 413);
      }

      const fileBuffer = await file.arrayBuffer();
      const head = new Uint8Array(fileBuffer.slice(0, 4));
      if (head[0] !== 0x50 || head[1] !== 0x4B) {
        return errorResponse('File không phải là định dạng ZIP/EPUB hợp lệ', 400);
      }

      const bookId = 'b_' + crypto.randomUUID();

      // Check if client provided pre-parsed metadata to save server CPU
      let metadata = null;
      const metaField = formData.get('metadata');
      if (metaField) {
        try {
          const parsed = typeof metaField === 'string' ? JSON.parse(metaField) : metaField;
          if (parsed && parsed.title && Array.isArray(parsed.chapters) && parsed.chapters.length > 0) {
            metadata = {
              title: parsed.title,
              author: parsed.author || 'Khuyết danh',
              coverBase64: parsed.coverBase64 || parsed.cover_data || null,
              chapters: parsed.chapters
            };
          }
        } catch (e) {
          console.warn('Metadata parsing error, falling back to server parse:', e);
        }
      }

      // Fast metadata extraction fallback on server
      if (!metadata) {
        const zip = await JSZip.loadAsync(fileBuffer);
        metadata = await parseEpubMetadataOnly(zip, file.name);
      }

      let hasCover = 0;
      if (metadata.coverBase64) {
        if (env.BUCKET) {
          const match = metadata.coverBase64.match(/^data:(image\/[^;]+);base64,(.+)$/);
          if (match) {
            const mime = match[1];
            const bin = atob(match[2]);
            const u8 = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
            await env.BUCKET.put(`covers/${bookId}`, u8, {
              httpMetadata: { contentType: mime }
            });
            hasCover = 1;
          }
        }
        if (!hasCover && metadata.coverBase64.length < 1000000) {
          await env.DB.prepare('INSERT OR REPLACE INTO covers (book_id, cover_data) VALUES (?, ?)')
            .bind(bookId, metadata.coverBase64)
            .run();
          hasCover = 1;
        }
      }

      // Encode TOC safely: compressed if > 60KB so it never exceeds D1 100KB statement limit
      const encodedToc = await encodeTocJson(metadata.chapters, env, bookId);

      // Save book record
      await env.DB.prepare(
        'INSERT INTO books (id, user_id, title, author, total_chapters, current_chapter, scroll_percent, has_cover, chapters_json, added_at, toc_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        bookId,
        userId,
        metadata.title,
        metadata.author,
        metadata.chapters.length,
        1,
        0,
        hasCover,
        encodedToc,
        Date.now(),
        TOC_VERSION
      ).run();

      if (env.BUCKET) {
        await env.BUCKET.put(`epubs/${bookId}.epub`, fileBuffer, {
          httpMetadata: { contentType: 'application/epub+zip' }
        });
      } else {
        // Save raw EPUB in 60KB chunks to bypass D1 SQL length limits
        const CHUNK_SIZE = 60 * 1024;
        const uint8 = new Uint8Array(fileBuffer);
        const totalChunks = Math.ceil(uint8.length / CHUNK_SIZE);
        const chunkStatements = [];

        for (let i = 0; i < totalChunks; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(uint8.length, start + CHUNK_SIZE);
          const slice = uint8.subarray(start, end);
          const b64 = toBase64Fast(slice);

          chunkStatements.push(
            env.DB.prepare('INSERT INTO book_chunks (book_id, chunk_index, data) VALUES (?, ?, ?)')
              .bind(bookId, i, b64)
          );
        }

        // Batch in groups of 8 statements (~480KB) to respect D1 payload limits (<1MB)
        const BATCH_SIZE = 8;
        for (let i = 0; i < chunkStatements.length; i += BATCH_SIZE) {
          await env.DB.batch(chunkStatements.slice(i, i + BATCH_SIZE));
        }
      }
      return jsonResponse({
        id: bookId,
        title: metadata.title,
        author: metadata.author,
        total_chapters: metadata.chapters.length,
        current_chapter: 1,
        scroll_percent: 0,
        has_cover: !!hasCover,
        added_at: Date.now()
      });
    }

    // 4.1 Books: Download EPUB file stream
    const matchFile = path.match(/^\/api\/books\/([^\/]+)\/file$/);
    if (matchFile && request.method === 'GET') {
      const bookId = matchFile[1];
      if (env.BUCKET) {
        const r2File = await env.BUCKET.get(`epubs/${bookId}.epub`);
        if (r2File) {
          return new Response(r2File.body, {
            headers: {
              ...CORS_HEADERS,
              'Content-Type': 'application/epub+zip',
              'Content-Disposition': `attachment; filename="${bookId}.epub"`,
              'Cache-Control': 'private, max-age=86400'
            }
          });
        }
      }

      const { results } = await env.DB.prepare(
        'SELECT chunk_index, data FROM book_chunks WHERE book_id = ? ORDER BY chunk_index ASC'
      ).bind(bookId).all();

      if (!results || results.length === 0) return errorResponse('File not found', 404);

      let totalLen = 0;
      const buffers = results.map(row => {
        const bin = atob(row.data);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        totalLen += u8.length;
        return u8;
      });

      const merged = new Uint8Array(totalLen);
      let offset = 0;
      for (const b of buffers) {
        merged.set(b, offset);
        offset += b.length;
      }

      return new Response(merged, {
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/epub+zip',
          'Content-Disposition': `attachment; filename="${bookId}.epub"`,
          'Cache-Control': 'private, max-age=86400'
        }
      });
    }

    // 5. Books: Get Detail & TOC
    const matchDetail = path.match(/^\/api\/books\/([^\/]+)$/);
    if (matchDetail && request.method === 'GET') {
      const bookId = matchDetail[1];
      let record = await env.DB.prepare('SELECT * FROM books WHERE id = ? AND user_id = ?')
        .bind(bookId, userId)
        .first();

      if (!record) return errorResponse('Không tìm thấy sách', 404);

      // Self-heal books indexed by an older TOC parser (dropped #anchors -> wrong chapter)
      if ((record.toc_version || 0) < TOC_VERSION) {
        const repaired = await reindexBook(env, record);
        if (repaired) {
          record = await env.DB.prepare('SELECT * FROM books WHERE id = ? AND user_id = ?')
            .bind(bookId, userId)
            .first();
        }
      }

      const chapters = await decodeTocJson(record.chapters_json, env, bookId);
      return jsonResponse({
        record: {
          id: record.id,
          title: record.title,
          author: record.author,
          total_chapters: record.total_chapters,
          current_chapter: record.current_chapter,
          scroll_percent: record.scroll_percent,
          para_index: record.para_index || 0,
          focus_para: record.focus_para ?? -1,
          focus_chapter: record.focus_chapter ?? -1,
          has_cover: !!record.has_cover,
          added_at: record.added_at
        },
        chapters
      });
    }

    // 6. Books: Get Chapter Content
    const matchChapter = path.match(/^\/api\/books\/([^\/]+)\/chapters\/(\d+)$/);
    if (matchChapter && request.method === 'GET') {
      const bookId = matchChapter[1];
      const chapterIdx = parseInt(matchChapter[2]);

      const record = await env.DB.prepare('SELECT total_chapters, chapters_json FROM books WHERE id = ? AND user_id = ?')
        .bind(bookId, userId)
        .first();

      if (!record) return errorResponse('Không tìm thấy sách', 404);

      const chapterRow = await env.DB.prepare(
        'SELECT title, content FROM chapters WHERE book_id = ? AND chapter_index = ?'
      ).bind(bookId, chapterIdx).first();

      let title = `Chương ${chapterIdx}`;
      let content_html = '';

      if (chapterRow) {
        title = chapterRow.title;
        content_html = chapterRow.content;
      } else {
        // Extract chapter on-the-fly: check R2 first, fallback to book_chunks
        let epubBytes = null;
        if (env.BUCKET) {
          const r2Obj = await env.BUCKET.get(`epubs/${bookId}.epub`);
          if (r2Obj) {
            epubBytes = await r2Obj.arrayBuffer();
          }
        }
        if (!epubBytes) {
          const { results: chunkRows } = await env.DB.prepare(
            'SELECT data FROM book_chunks WHERE book_id = ? ORDER BY chunk_index ASC'
          ).bind(bookId).all();

          if (chunkRows && chunkRows.length > 0) {
            let totalLen = 0;
            const buffers = chunkRows.map(row => {
              const bin = atob(row.data);
              const u8 = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
              totalLen += u8.length;
              return u8;
            });
            const merged = new Uint8Array(totalLen);
            let offset = 0;
            for (const b of buffers) {
              merged.set(b, offset);
              offset += b.length;
            }
            epubBytes = merged.buffer;
          }
        }

        if (epubBytes) {
          const toc = await decodeTocJson(record.chapters_json, env, bookId);
          const targetCh = toc.find(c => c.index === chapterIdx);
          title = targetCh?.title || `Chương ${chapterIdx}`;

          const zip = await JSZip.loadAsync(epubBytes);
          content_html = await extractChapterContent(zip, toc, chapterIdx, targetCh);
          content_html = stripDuplicateHeading(content_html, title);

          // Cache in chapters table so subsequent reads are instant (< 2ms)
          if (content_html) {
            env.DB.prepare(`
              INSERT INTO chapters (book_id, chapter_index, title, content)
              VALUES (?, ?, ?, ?)
              ON CONFLICT (book_id, chapter_index)
              DO UPDATE SET content = excluded.content, title = excluded.title
            `).bind(bookId, chapterIdx, title, content_html).run().catch(e => console.error('Chapter cache error:', e));
          }
        }
      }

      return jsonResponse({
        book_id: bookId,
        chapter_index: chapterIdx,
        title,
        content_html: content_html || '<p>Chương trống.</p>',
        total_chapters: record.total_chapters,
        prev_index: chapterIdx > 1 ? chapterIdx - 1 : null,
        next_index: chapterIdx < record.total_chapters ? chapterIdx + 1 : null
      });
    }

    // 6.1 Books: Update Chapter Content (Sửa văn bản chương)
    if (matchChapter && (request.method === 'PUT' || request.method === 'POST')) {
      const bookId = matchChapter[1];
      const chapterIdx = parseInt(matchChapter[2]);
      const body = await request.json();
      const content_html = body?.content_html;
      const title = body?.title || `Chương ${chapterIdx}`;

      if (!content_html) return errorResponse('Thiếu nội dung chương', 400);

      const book = await env.DB.prepare('SELECT id FROM books WHERE id = ? AND user_id = ?')
        .bind(bookId, userId).first();
      if (!book) return errorResponse('Không tìm thấy sách', 404);

      await env.DB.prepare(`
        INSERT INTO chapters (book_id, chapter_index, title, content)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (book_id, chapter_index)
        DO UPDATE SET content = excluded.content, title = excluded.title
      `).bind(bookId, chapterIdx, title, content_html).run();

      return jsonResponse({ success: true, book_id: bookId, chapter_index: chapterIdx, title });
    }
    // 7. Books: Update Progress
    const matchProgress = path.match(/^\/api\/books\/([^\/]+)\/progress$/);
    if (matchProgress && request.method === 'POST') {
      const bookId = matchProgress[1];
      const { chapter_index, scroll_percent, chapter_title, book_title, para_index, focus_para, focus_chapter } = await request.json();

      let resolvedTitle = book_title;
      if (!resolvedTitle || resolvedTitle === 'Sách') {
        const bRow = await env.DB.prepare('SELECT title FROM books WHERE id = ?').bind(bookId).first();
        resolvedTitle = bRow?.title || 'Sách';
      }

      const paraIdx = Number.isFinite(para_index) ? para_index : 0;
      const focusIdx = Number.isFinite(focus_para) ? focus_para : -1;
      // -1 = không ghim; ngược lại ghim gắn với đúng chương đang đọc
      const focusChap = Number.isFinite(focus_chapter)
        ? focus_chapter
        : (focusIdx >= 0 ? chapter_index : -1);

      await env.DB.prepare(
        'UPDATE books SET current_chapter = ?, scroll_percent = ?, para_index = ?, focus_para = ?, focus_chapter = ? WHERE id = ? AND user_id = ?'
      ).bind(chapter_index, scroll_percent, paraIdx, focusIdx, focusChap, bookId, userId).run();

      await env.DB.prepare(`
        INSERT INTO progress (user_id, book_id, book_title, chapter_index, chapter_title, scroll_percent, para_index, focus_para, focus_chapter, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, book_id) DO UPDATE SET
          book_title = excluded.book_title,
          chapter_index = excluded.chapter_index,
          chapter_title = excluded.chapter_title,
          scroll_percent = excluded.scroll_percent,
          para_index = excluded.para_index,
          focus_para = excluded.focus_para,
          focus_chapter = excluded.focus_chapter,
          updated_at = excluded.updated_at
      `).bind(userId, bookId, resolvedTitle, chapter_index, chapter_title || `Chương ${chapter_index}`, scroll_percent, paraIdx, focusIdx, focusChap, Date.now()).run();

      return jsonResponse({ success: true });
    }

    // 8. History: Full reading history for multiple books
    if (path === '/api/history' && request.method === 'GET') {
      const { results } = await env.DB.prepare(`
        SELECT p.book_id, COALESCE(b.title, p.book_title) AS book_title, p.chapter_index, p.chapter_title, p.scroll_percent, p.para_index, p.focus_para, p.focus_chapter, p.updated_at,
               b.author, b.total_chapters, b.has_cover
        FROM progress p
        LEFT JOIN books b ON p.book_id = b.id
        WHERE p.user_id = ?
        ORDER BY p.updated_at DESC
        LIMIT 20
      `).bind(userId).all();

      return jsonResponse(results || []);
    }

    // 8.1 Bookmarks: list / create / delete (Cờ đánh dấu vị trí đọc)
    const matchBookmarks = path.match(/^\/api\/books\/([^\/]+)\/bookmarks$/);
    if (matchBookmarks) {
      const bookId = matchBookmarks[1];

      if (request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT id, chapter_index, para_index, scroll_percent, excerpt, note, created_at FROM bookmarks WHERE user_id = ? AND book_id = ? ORDER BY chapter_index ASC, para_index ASC'
        ).bind(userId, bookId).all();

        return jsonResponse(results || []);
      }

      if (request.method === 'POST') {
        const { chapter_index, para_index, scroll_percent, excerpt, note } = await request.json();
        if (!Number.isFinite(chapter_index) || !Number.isFinite(para_index)) {
          return errorResponse('Thiếu vị trí đánh dấu');
        }

        const existing = await env.DB.prepare(
          'SELECT id FROM bookmarks WHERE user_id = ? AND book_id = ? AND chapter_index = ? AND para_index = ?'
        ).bind(userId, bookId, chapter_index, para_index).first();

        if (existing) {
          await env.DB.prepare('DELETE FROM bookmarks WHERE id = ?').bind(existing.id).run();
          return jsonResponse({ success: true, removed: true, id: existing.id });
        }

        const bmId = 'bm_' + crypto.randomUUID();
        await env.DB.prepare(
          'INSERT INTO bookmarks (id, user_id, book_id, chapter_index, para_index, scroll_percent, excerpt, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          bmId, userId, bookId, chapter_index, para_index,
          scroll_percent || 0, (excerpt || '').slice(0, 240), (note || '').slice(0, 240), Date.now()
        ).run();

        return jsonResponse({ success: true, removed: false, id: bmId });
      }

      if (request.method === 'DELETE') {
        const { id } = await request.json();
        if (id) {
          await env.DB.prepare('DELETE FROM bookmarks WHERE id = ? AND user_id = ?').bind(id, userId).run();
        } else {
          await env.DB.prepare('DELETE FROM bookmarks WHERE user_id = ? AND book_id = ?').bind(userId, bookId).run();
        }
        return jsonResponse({ success: true });
      }
    }

    // 9. Last Read (Latest active book)
    if (path === '/api/last-read' && request.method === 'GET') {
      const last = await env.DB.prepare(
        'SELECT * FROM progress WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1'
      ).bind(userId).first();

      return jsonResponse(last || null);
    }
    // 10. Settings: Get & Update Reader Settings
    if (path === '/api/settings') {
      if (request.method === 'GET') {
        const row = await env.DB.prepare(
          'SELECT settings_json FROM user_settings WHERE user_id = ?'
        ).bind(userId).first();
        let settings = null;
        if (row && row.settings_json) {
          try {
            settings = JSON.parse(row.settings_json);
          } catch (e) {}
        }
        return jsonResponse({ settings });
      }

      if (request.method === 'POST') {
        const body = await request.json();
        const settings = body?.settings;
        if (!settings || typeof settings !== 'object') {
          return errorResponse('Cài đặt không hợp lệ');
        }
        await env.DB.prepare(`
          INSERT INTO user_settings (user_id, settings_json, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at
        `).bind(userId, JSON.stringify(settings), Date.now()).run();

        return jsonResponse({ success: true });
      }
    }

    // 9. Cover Image Stream from D1
    const matchCover = path.match(/^\/api\/books\/([^\/]+)\/cover$/);
    if (matchCover && request.method === 'GET') {
      const bookId = matchCover[1];
      const book = await env.DB.prepare('SELECT user_id FROM books WHERE id = ?').bind(bookId).first();
      if (!book) return new Response('Cover not found', { status: 404 });
      if (book.user_id !== userId) {
        return errorResponse('Không có quyền truy cập ảnh bìa này', 403);
      }

      if (env.BUCKET) {
        const r2Cover = await env.BUCKET.get(`covers/${bookId}`);
        if (r2Cover) {
          const headers = new Headers(CORS_HEADERS);
          headers.set('Content-Type', r2Cover.httpMetadata?.contentType || 'image/jpeg');
          headers.set('Cache-Control', 'private, max-age=86400');
          headers.set('Referrer-Policy', 'no-referrer');
          return new Response(r2Cover.body, { headers });
        }
      }

      const row = await env.DB.prepare('SELECT cover_data FROM covers WHERE book_id = ?').bind(bookId).first();
      if (!row || !row.cover_data) return new Response('Cover not found', { status: 404 });

      // cover_data is data:image/...;base64,...
      const match = row.cover_data.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (match) {
        const mime = match[1];
        const binary = atob(match[2]);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const headers = new Headers(CORS_HEADERS);
        headers.set('Content-Type', mime);
        headers.set('Cache-Control', 'private, max-age=86400');
        headers.set('Referrer-Policy', 'no-referrer');
        return new Response(bytes, { headers });
      }

      return new Response('Invalid cover data', { status: 500 });
    }

    // 10. Delete Book
    if (matchDetail && request.method === 'DELETE') {
      const bookId = matchDetail[1];
      if (env.BUCKET) {
        await env.BUCKET.delete([`epubs/${bookId}.epub`, `covers/${bookId}`, `tocs/${bookId}.json`]);
      }
      await env.DB.batch([
        env.DB.prepare('DELETE FROM books WHERE id = ? AND user_id = ?').bind(bookId, userId),
        env.DB.prepare('DELETE FROM chapters WHERE book_id = ?').bind(bookId),
        env.DB.prepare('DELETE FROM book_chunks WHERE book_id = ?').bind(bookId),
        env.DB.prepare('DELETE FROM book_tocs WHERE book_id = ?').bind(bookId),
        env.DB.prepare('DELETE FROM covers WHERE book_id = ?').bind(bookId),
        env.DB.prepare('DELETE FROM bookmarks WHERE book_id = ? AND user_id = ?').bind(bookId, userId),
        env.DB.prepare('DELETE FROM progress WHERE book_id = ? AND user_id = ?').bind(bookId, userId),
      ]);
      return jsonResponse({ success: true });
    }

      return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
    } catch (err) {
      console.error('API Error:', err);
      return errorResponse(err.message || 'Lỗi xử lý máy chủ', 500);
    }
  }
};

// -----------------------------------------------------------------------------
// D1 DATABASE SCHEMA INITIALIZATION
// -----------------------------------------------------------------------------

let tablesInitialized = false;

async function initTables(db) {
  if (tablesInitialized) return;
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `).run();
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS books (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        author TEXT,
        total_chapters INTEGER NOT NULL,
        current_chapter INTEGER DEFAULT 1,
        scroll_percent REAL DEFAULT 0,
        para_index INTEGER DEFAULT 0,
        has_cover INTEGER DEFAULT 0,
        chapters_json TEXT NOT NULL,
        added_at INTEGER NOT NULL
      )
    `).run();
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS bookmarks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        book_id TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        para_index INTEGER NOT NULL,
        scroll_percent REAL DEFAULT 0,
        excerpt TEXT,
        note TEXT,
        created_at INTEGER NOT NULL
      )
    `).run();
    await db.prepare(
      'CREATE INDEX IF NOT EXISTS idx_bookmarks_user_book ON bookmarks (user_id, book_id)'
    ).run();
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS covers (
        book_id TEXT PRIMARY KEY,
        cover_data TEXT NOT NULL
      )
    `).run();
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS chapters (
        book_id TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        PRIMARY KEY (book_id, chapter_index)
      )
    `).run();
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS book_chunks (
        book_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (book_id, chunk_index)
      )
    `).run();
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS book_tocs (
        book_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (book_id, chunk_index)
      )
    `).run();
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS progress (
        user_id TEXT NOT NULL,
        book_id TEXT NOT NULL,
        book_title TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        chapter_title TEXT NOT NULL,
        scroll_percent REAL NOT NULL,
        para_index INTEGER DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, book_id)
      )
    `).run();
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT PRIMARY KEY,
        settings_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `).run();
    tablesInitialized = true;
  } catch (e) {
    console.error('initTables error:', e);
  }
}

// -----------------------------------------------------------------------------
// FULL EPUB EXTRACTOR
// -----------------------------------------------------------------------------

// EPUBs often pack many chapters into one XHTML file and address each chapter
// with a fragment anchor (#filepos...). The chapter slice runs from its own
// anchor to the next chapter anchor inside the same file.
const TOC_VERSION = 2;

function toBase64Fast(u8) {
  let binary = '';
  const len = u8.byteLength;
  const CHUNK = 8192;
  for (let i = 0; i < len; i += CHUNK) {
    binary += String.fromCharCode.apply(null, u8.subarray(i, Math.min(len, i + CHUNK)));
  }
  return btoa(binary);
}

async function encodeTocJson(chapters, env, bookId) {
  const json = JSON.stringify((chapters || []).map(c => ({ index: c.index, title: c.title, href: c.href })));

  // If R2 is enabled, store full uncompressed TOC JSON in R2
  if (env && env.BUCKET && bookId) {
    try {
      await env.BUCKET.put(`tocs/${bookId}.json`, json, {
        httpMetadata: { contentType: 'application/json' }
      });
    } catch (e) {
      console.error('Failed to put TOC to R2:', e);
    }
  }

  // Under 60KB: store raw JSON directly in D1
  if (json.length <= 60000) return json;

  // Deflate-compress to fit within Cloudflare D1 100KB statement limit
  try {
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    writer.write(new TextEncoder().encode(json));
    writer.close();
    const reader = cs.readable.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((acc, c) => acc + c.length, 0);
    const u8 = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      u8.set(c, off);
      off += c.length;
    }
    const b64 = 'gz:' + toBase64Fast(u8);

    // Fits in D1 single statement
    if (b64.length <= 85000) return b64;

    // Fallback for massive books (5,000+ chapters): split into book_tocs table
    if (env && env.DB && bookId) {
      const TOC_CHUNK = 60000;
      const totalTocs = Math.ceil(b64.length / TOC_CHUNK);
      for (let i = 0; i < totalTocs; i++) {
        const slice = b64.slice(i * TOC_CHUNK, (i + 1) * TOC_CHUNK);
        await env.DB.prepare('INSERT OR REPLACE INTO book_tocs (book_id, chunk_index, data) VALUES (?, ?, ?)')
          .bind(bookId, i, slice)
          .run();
      }
      return 'table:book_tocs';
    }
    return b64;
  } catch (e) {
    console.error('encodeTocJson compression failed:', e);
    return json.slice(0, 50000);
  }
}

async function decodeTocJson(str, env, bookId) {
  // If R2 has the TOC, load directly from R2
  if (env && env.BUCKET && bookId) {
    try {
      const r2Toc = await env.BUCKET.get(`tocs/${bookId}.json`);
      if (r2Toc) {
        return await r2Toc.json();
      }
    } catch (e) {}
  }

  if (!str) return [];

  // Check if chunked in book_tocs table
  if (str === 'table:book_tocs' && env && env.DB && bookId) {
    try {
      const { results } = await env.DB.prepare(
        'SELECT data FROM book_tocs WHERE book_id = ? ORDER BY chunk_index ASC'
      ).bind(bookId).all();
      if (results && results.length > 0) {
        str = results.map(r => r.data).join('');
      }
    } catch (e) {
      console.error('Failed to read book_tocs:', e);
    }
  }

  if (!str.startsWith('gz:')) {
    try {
      return JSON.parse(str);
    } catch (e) {
      return [];
    }
  }

  try {
    const rawB64 = str.slice(3);
    const bin = atob(rawB64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);

    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(u8);
    writer.close();
    const reader = ds.readable.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((acc, c) => acc + c.length, 0);
    const resU8 = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      resU8.set(c, off);
      off += c.length;
    }
    return JSON.parse(new TextDecoder().decode(resU8));
  } catch (e) {
    console.error('decodeTocJson decompression failed:', e);
    return [];
  }
}

function safeDecodeURI(uri) {
  try {
    return decodeURIComponent(uri);
  } catch (e) {
    return uri;
  }
}

function anchorOffset(html, anchor) {
  if (!anchor) return -1;
  const decodedAnchor = safeDecodeURI(anchor);
  let pos = -1;
  const candidates = anchor === decodedAnchor ? [anchor] : [anchor, decodedAnchor];
  for (const a of candidates) {
    for (const p of [`id="${a}"`, `id='${a}'`, `name="${a}"`, `name='${a}'`]) {
      const i = html.indexOf(p);
      if (i >= 0 && (pos < 0 || i < pos)) pos = i;
    }
  }
  if (pos < 0) return -1;
  const lt = html.lastIndexOf('<', pos);
  return lt >= 0 ? lt : pos;
}

function splitHref(href) {
  const raw = (href || '').trim();
  const hashAt = raw.indexOf('#');
  if (hashAt < 0) return { file: safeDecodeURI(raw).replace(/\\/g, '/'), anchor: '' };
  return {
    file: safeDecodeURI(raw.slice(0, hashAt)).replace(/\\/g, '/'),
    anchor: safeDecodeURI(raw.slice(hashAt + 1))
  };
}

async function reindexBook(env, record) {
  try {
    const { results: chunkRows } = await env.DB.prepare(
      'SELECT data FROM book_chunks WHERE book_id = ? ORDER BY chunk_index ASC'
    ).bind(record.id).all();

    if (!chunkRows || chunkRows.length === 0) {
      await env.DB.prepare('UPDATE books SET toc_version = ? WHERE id = ?').bind(TOC_VERSION, record.id).run();
      return false;
    }

    let totalLen = 0;
    const buffers = chunkRows.map(row => {
      const bin = atob(row.data);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      totalLen += u8.length;
      return u8;
    });
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const b of buffers) {
      merged.set(b, offset);
      offset += b.length;
    }

    const zip = await JSZip.loadAsync(merged);
    const metadata = await parseEpubMetadataOnly(zip, `${record.title}.epub`);
    if (!metadata.chapters || metadata.chapters.length === 0) {
      await env.DB.prepare('UPDATE books SET toc_version = ? WHERE id = ?').bind(TOC_VERSION, record.id).run();
      return false;
    }

    // Any chapter content cached by the old parser is invalid now.
    await env.DB.prepare('DELETE FROM chapters WHERE book_id = ?').bind(record.id).run();

    const encodedToc = await encodeTocJson(metadata.chapters, env, record.id);
    await env.DB.prepare(
      'UPDATE books SET chapters_json = ?, total_chapters = ?, toc_version = ? WHERE id = ?'
    ).bind(
      encodedToc,
      metadata.chapters.length,
      TOC_VERSION,
      record.id
    ).run();

    return true;
  } catch (e) {
    console.error('reindexBook failed:', e);
    return false;
  }
}

async function extractChapterContent(zip, toc, chapterIdx, targetCh) {
  if (!targetCh || !targetCh.href) return '';

  const { file, anchor } = splitHref(targetCh.href);
  const chFile = findZipFile(zip, file);
  if (!chFile) return '';

  const raw = await chFile.async('text');

  // Mục đầu tiên của mỗi file trong NCX KHÔNG kèm #fragment (ví dụ
  // "1/1/OEBPS/text00033.html"), trong khi các mục sau trong cùng file thì có.
  // Trước đây gặp trường hợp này là trả về nguyên file -> chương chứa luôn
  // tiêu đề của hàng chục chương kế tiếp, không khớp với tiêu đề đã chọn.
  // Nay: không có anchor => chương bắt đầu từ đầu file, và vẫn phải cắt tại
  // anchor của chương kế tiếp trong cùng file.
  const found = anchor ? anchorOffset(raw, anchor) : 0;
  if (anchor && found < 0) return cleanXhtml(raw);
  const start = found >= 0 ? found : 0;

  // Nearest following chapter anchor inside the same file closes this chapter.
  let end = -1;
  for (const c of toc) {
    if (!c || c.index <= chapterIdx) continue;
    const other = splitHref(c.href);
    if (other.file !== file || !other.anchor) continue;
    const off = anchorOffset(raw, other.anchor);
    if (off > start && (end < 0 || off < end)) end = off;
  }

  const slice = end > start ? raw.slice(start, end) : raw.slice(start);
  return cleanXhtml(slice);
}

function parseNcxEntries(ncxXml) {
  const tokens = [];
  const re = /<(\/?)navPoint\b[^>]*>/gi;
  let m;
  while ((m = re.exec(ncxXml)) !== null) {
    tokens.push({ close: m[1] === '/', from: m.index, to: m.index + m[0].length });
  }

  const entries = [];
  const stack = [];
  for (const t of tokens) {
    if (!t.close) {
      stack.push({ bodyFrom: t.to });
      continue;
    }
    const node = stack.pop();
    if (!node) continue;

    const body = ncxXml.slice(node.bodyFrom, t.from);

    const labelMatch = body.match(/<navLabel\b[^>]*>([\s\S]*?)<\/navLabel>/i);
    let title = '';
    if (labelMatch) {
      const textMatch = labelMatch[1].match(/<text\b[^>]*>([\s\S]*?)<\/text>/i);
      if (textMatch) title = decodeEntities(textMatch[1]).trim();
    }

    // A navPoint's own <content> always precedes any nested navPoint.
    const firstNested = body.search(/<navPoint\b/i);
    const own = firstNested >= 0 ? body.slice(0, firstNested) : body;
    const srcMatch = own.match(/<content\b[^>]*src\s*=\s*['"]([^'"]+)['"]/i);
    const rawSrc = srcMatch ? srcMatch[1].trim() : null;
    entries.push({ title, src: rawSrc ? safeDecodeURI(rawSrc) : null });
  }

  return entries;
}

function decodeEntities(s) {
  return (s || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function getZipNormalizedMap(zip) {
  if (zip._normMap) return zip._normMap;
  const map = new Map();
  for (const name of Object.keys(zip.files)) {
    map.set(name.toLowerCase().replace(/\\/g, '/'), zip.files[name]);
  }
  zip._normMap = map;
  return map;
}

function findZipFile(zip, filename) {
  if (!filename) return null;
  const decoded = safeDecodeURI(filename);
  if (zip.files[decoded]) return zip.files[decoded];
  if (zip.files[filename]) return zip.files[filename];

  const targetDecoded = decoded.toLowerCase().replace(/\\/g, '/');
  const targetRaw = filename.toLowerCase().replace(/\\/g, '/');
  const map = getZipNormalizedMap(zip);
  if (map.has(targetDecoded)) return map.get(targetDecoded);
  if (map.has(targetRaw)) return map.get(targetRaw);

  for (const [key, file] of map.entries()) {
    if (key.endsWith(targetDecoded) || key.endsWith(targetRaw)) return file;
  }

  const baseName = targetDecoded.split('/').pop();
  if (baseName) {
    for (const [key, file] of map.entries()) {
      if (key.split('/').pop() === baseName) return file;
    }
  }

  return null;
}

function getTagText(xml, tagName) {
  if (!xml) return '';
  const re = new RegExp('<(?:[a-zA-Z0-9_-]+:)?' + tagName + '[^>]*>([\\s\\S]*?)</(?:[a-zA-Z0-9_-]+:)?' + tagName + '>', 'i');
  const m = xml.match(re);
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').trim() : '';
}

async function parseEpubMetadataOnly(zip, fallbackName) {
  const containerFile = findZipFile(zip, 'META-INF/container.xml');
  const containerXml = await containerFile.async('text');
  const m_root = containerXml.match(/full-path=['"]([^'"]+)['"]/i);
  const opfPath = m_root ? m_root[1].trim() : 'OEBPS/content.opf';
  const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/')) : '';

  const opfFile = findZipFile(zip, opfPath);
  const opfXml = await opfFile.async('text');

  const title = getTagText(opfXml, 'title') || fallbackName.replace(/\.epub$/i, '');
  const author = getTagText(opfXml, 'creator') || 'Khuyết danh';

  const manifest = {};
  const itemRegex = /<item\s+[^>]*>/gi;
  let match;
  while ((match = itemRegex.exec(opfXml)) !== null) {
    const itemTag = match[0];
    const idM = itemTag.match(/id=['"]([^'"]+)['"]/i);
    const hrefM = itemTag.match(/href=['"]([^'"]+)['"]/i);
    if (idM && hrefM) manifest[idM[1]] = hrefM[1].trim();
  }

  // Cover image
  let coverBase64 = null;
  let coverHref = null;
  const coverMeta = opfXml.match(/<meta\s+[^>]*name=['"]cover['"][^>]*content=['"]([^'"]+)['"]/i);
  if (coverMeta && manifest[coverMeta[1]]) coverHref = manifest[coverMeta[1]];
  if (!coverHref) {
    if (manifest['cover-image']) coverHref = manifest['cover-image'];
    else if (manifest['cover']) coverHref = manifest['cover'];
  }
  if (!coverHref) {
    for (const [id, href] of Object.entries(manifest)) {
      if ((id.toLowerCase().includes('cover') || href.toLowerCase().includes('cover')) && /\.(jpe?g|png|webp)$/i.test(href)) {
        coverHref = href;
        break;
      }
    }
  }
  if (coverHref) {
    const coverFile = findZipFile(zip, opfDir ? `${opfDir}/${coverHref}` : coverHref);
    if (coverFile) {
      const b64 = await coverFile.async('base64');
      const ext = coverHref.toLowerCase().endsWith('.png') ? 'png' : (coverHref.toLowerCase().endsWith('.webp') ? 'webp' : 'jpeg');
      coverBase64 = `data:image/${ext};base64,${b64}`;
    }
  }

  // TOC from NCX (depth-aware: pairs each navPoint's own label with its own src,
  // and keeps the fragment anchor that identifies the chapter inside a file)
  let chapters = [];
  let ncxHref = null;
  for (const [id, href] of Object.entries(manifest)) {
    if (id.toLowerCase().includes('ncx') || href.toLowerCase().endsWith('.ncx')) {
      ncxHref = href;
      break;
    }
  }
  if (ncxHref) {
    const ncxFile = findZipFile(zip, opfDir ? `${opfDir}/${ncxHref}` : ncxHref);
    if (ncxFile) {
      const ncxXml = await ncxFile.async('text');
      const entries = parseNcxEntries(ncxXml);
      const seen = new Set();
      let idx = 1;
      for (const e of entries) {
        if (!e.src) continue;
        const src = (opfDir ? `${opfDir}/${e.src}` : e.src).replace(/\\/g, '/');
        if (seen.has(src)) continue;
        seen.add(src);
        chapters.push({ index: idx, title: e.title || `Chương ${idx}`, href: src });
        idx++;
      }
    }
  }

  // Fallback: If no NCX or empty, read from spine
  if (chapters.length === 0) {
    const spineRegex = /<itemref\s+[^>]*idref=['"]([^'"]+)['"][^>]*>/gi;
    let sMatch, idx = 1;
    while ((sMatch = spineRegex.exec(opfXml)) !== null) {
      const idref = sMatch[1];
      const href = manifest[idref];
      if (href && /\.(x?html?|xml)$/i.test(href)) {
        const fullSrc = (opfDir ? `${opfDir}/${href}` : href).replace(/\\/g, '/');
        chapters.push({
          index: idx,
          title: `Chương ${idx}`,
          href: fullSrc
        });
        idx++;
      }
    }
  }

  return { title, author, coverBase64, chapters };
}

// Chuẩn hoá HTML trích ra: bỏ thẻ định dạng/class/attr lạ của EPUB,
// dựng lại thành các đoạn <p> sạch để CSS của trình đọc kiểm soát hoàn toàn.
function cleanXhtml(raw) {
  let bodyContent = raw || '';
  const bodyM = bodyContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyM) bodyContent = bodyM[1];

  // Strip dangerous tag blocks
  bodyContent = bodyContent
    .replace(/<(script|style|iframe|object|embed|svg|math|form|base|meta|link|applet)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|svg|math|form|base|meta|link|applet)\b[^>]*>/gi, '')
    .replace(/<span\b[^>]*><\/span>/gi, '');

  const plain = (s) => (s || '')
    // Remove inline event handlers
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gis, '')
    .replace(/\son\w+\s*=\s*[^ >]+/gis, '')
    // Remove dangerous protocols
    .replace(/(href|src)\s*=\s*(['"])\s*(javascript|vbscript|data):.*?\2/gis, '')
    // Strip all tags EXCEPT safe formatting: em, strong, b, i, u, br
    .replace(/<(?!\/?(i|em|b|strong|u|br)\b)[^>]*>/gi, '')
    // Strip any attributes left on the remaining safe formatting tags
    .replace(/<(i|em|b|strong|u)\b[^>]*>/gi, '<$1>')
    .replace(/\s+/g, ' ')
    .trim();

  const paragraphs = [];
  const blockRe = /<(p|div|h1|h2|h3|h4|h5|h6)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = blockRe.exec(bodyContent)) !== null) {
    const text = plain(m[2]);
    if (text.length > 0) paragraphs.push(text);
  }

  // Fallback: không có thẻ khối nào (HTML phẳng) -> chia theo <br>
  if (paragraphs.length === 0) {
    bodyContent.split(/<br\s*\/?>/gi).forEach(chunk => {
      const text = plain(chunk);
      if (text.length > 0) paragraphs.push(text);
    });
  }

  return paragraphs.map(t => `<p>${t}</p>`).join('\n');
}

// So sánh tiêu đề đã bỏ dấu câu/khoảng trắng để phát hiện dòng tiêu đề lặp lại
function normalizeHeading(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[\s\u00a0]+/g, '')
    .replace(/[.,:;!?"'“”‘’()\[\]\-–—…]/g, '');
}

// Nhiều EPUB lặp lại tiêu đề chương ngay dòng đầu nội dung -> bỏ để không trùng với tiêu đề của trình đọc
function stripDuplicateHeading(html, chapterTitle) {
  if (!html || !chapterTitle) return html;
  const m = html.match(/^<p>([\s\S]*?)<\/p>\s*/);
  if (!m) return html;
  const first = normalizeHeading(m[1]);
  const title = normalizeHeading(chapterTitle);
  if (!first || !title) return html;
  if (first === title || (first.startsWith(title) && first.length <= title.length + 6)) {
    return html.slice(m[0].length);
  }
  return html;
}
