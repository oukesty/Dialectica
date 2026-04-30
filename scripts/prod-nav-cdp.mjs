import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const { startServer } = require('next/dist/server/lib/start-server');

process.env.NODE_ENV = 'production';
process.env.NEXT_MANUAL_SIG_HANDLE = '1';

const port = 3214;
const debugPort = 9223;
const baseUrl = `http://127.0.0.1:${port}`;
const browserCandidates = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];

async function waitFor(fn, timeoutMs = 15000, intervalMs = 200) {
  const start = Date.now();
  for (;;) {
    try {
      const result = await fn();
      if (result) return result;
    } catch {
      // keep polling
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out while waiting for browser target.');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.seq = 0;
    this.pending = new Map();
    this.ws.addEventListener('message', (event) => {
      const payload = JSON.parse(String(event.data));
      if (payload.id && this.pending.has(payload.id)) {
        const { resolve, reject } = this.pending.get(payload.id);
        this.pending.delete(payload.id);
        if (payload.error) {
          reject(new Error(payload.error.message || 'CDP command failed'));
        } else {
          resolve(payload.result || {});
        }
      }
    });
  }

  async ready() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true });
      this.ws.addEventListener('error', (error) => reject(error), { once: true });
    });
  }

  async send(method, params = {}, sessionId) {
    await this.ready();
    const id = ++this.seq;
    const message = sessionId ? { id, method, params, sessionId } : { id, method, params };
    const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ws.send(JSON.stringify(message));
    return promise;
  }

  async evaluate(sessionId, expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }, sessionId);
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'Runtime.evaluate failed');
    }
    return result.result?.value;
  }

  close() {
    this.ws.close();
  }
}

let browserProcess;
let cdp;
let browserProfileDir;
let exitCode = 0;

try {
  await startServer({
    dir: process.cwd(),
    port,
    isDev: false,
    hostname: '127.0.0.1',
    allowRetry: false,
  });

  const browserPath = browserCandidates.find((candidate) => require('node:fs').existsSync(candidate));
  if (!browserPath) {
    throw new Error('No Edge/Chrome executable found for production navigation validation.');
  }

  browserProfileDir = await mkdtemp(path.join(os.tmpdir(), 'dialectica-prod-nav-'));
  browserProcess = spawn(browserPath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${browserProfileDir}`,
    'about:blank',
  ], {
    stdio: 'ignore',
    windowsHide: true,
  });

  const version = await waitFor(() => fetchJson(`http://127.0.0.1:${debugPort}/json/version`), 20000);
  cdp = new CdpClient(version.webSocketDebuggerUrl);
  const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const attachment = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const sessionId = attachment.sessionId;

  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Page.navigate', { url: `${baseUrl}/zh-CN` }, sessionId);

  const waitForPath = async (expectedPath) => waitFor(async () => {
    const currentPath = await cdp.evaluate(sessionId, 'location.pathname');
    return currentPath === expectedPath ? currentPath : null;
  }, 20000, 250);

  const clickHref = async (href) => {
    await cdp.evaluate(sessionId, `(() => {
      const target = document.querySelector(\`a[href="${href}"]\`);
      if (!target) throw new Error('Missing link: ${href}');
      target.click();
      return true;
    })()`);
  };

  await waitForPath('/zh-CN');
  await clickHref('/zh-CN/settings');
  await waitForPath('/zh-CN/settings');
  await clickHref('/zh-CN/projects/new');
  await waitForPath('/zh-CN/projects/new');
  await clickHref('/zh-CN');
  await waitForPath('/zh-CN');

  const title = await cdp.evaluate(sessionId, 'document.title');
  assert.match(String(title), /Dialectica/i);
  console.log('[prod-nav] homepage -> settings -> new project -> homepage navigation succeeded in production mode');
} catch (error) {
  exitCode = 1;
  console.error('[prod-nav] failed');
  console.error(error);
} finally {
  try {
    cdp?.close();
  } catch {}
  try {
    browserProcess?.kill();
  } catch {}
  try {
    if (browserProfileDir) await rm(browserProfileDir, { recursive: true, force: true });
  } catch {}
  process.exit(exitCode);
}
