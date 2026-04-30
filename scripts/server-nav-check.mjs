import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const { startServer } = require('next/dist/server/lib/start-server');

const mode = process.env.DIALECTICA_SERVER_MODE === 'dev' ? 'dev' : 'start';
const isDev = mode === 'dev';
const port = Number(process.env.DIALECTICA_SERVER_PORT || (isDev ? 3228 : 3227));
const baseUrl = `http://127.0.0.1:${port}`;

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  apply(headers = new Headers()) {
    if (this.cookies.size === 0) return headers;
    headers.set('cookie', Array.from(this.cookies.entries()).map(([key, value]) => `${key}=${value}`).join('; '));
    return headers;
  }

  absorb(response) {
    const setCookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : response.headers.get('set-cookie')
        ? [response.headers.get('set-cookie')]
        : [];

    for (const entry of setCookies) {
      const pair = entry.split(';', 1)[0];
      const separator = pair.indexOf('=');
      if (separator <= 0) continue;
      this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }
}

async function request(jar, pathname, options = {}) {
  const headers = jar.apply(new Headers(options.headers || {}));
  const response = await fetch(pathname.startsWith('http') ? pathname : `${baseUrl}${pathname}`, {
    ...options,
    headers,
    redirect: 'manual',
  });
  jar.absorb(response);
  return response;
}

async function requestJson(jar, pathname, options = {}) {
  const response = await request(jar, pathname, options);
  const text = await response.text();
  return { response, json: text ? JSON.parse(text) : null, text };
}

function ensureHtmlLooksHealthy(pathname, html) {
  assert.ok(html.includes('Dialectica'), `${pathname} should include Dialectica branding`);
  assert.doesNotMatch(html, /Internal Server Error|Application error|Invariant: The client reference manifest|ReferenceError|TypeError/i, `${pathname} should not contain a server error signature`);
}

async function waitForServerReady(pathname = '/api/settings') {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${pathname}`, { redirect: 'manual' });
      if (response.status > 0) return;
    } catch {
      // keep polling
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${mode} server on ${baseUrl}`);
}

const jar = new CookieJar();
let exitCode = 0;
let devProcess = null;

if (isDev) {
  const nextBin = require.resolve('next/dist/bin/next');
  devProcess = spawn(process.execPath, [nextBin, 'dev', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), HOSTNAME: '127.0.0.1' },
    stdio: 'inherit',
  });
  await waitForServerReady();
} else {
  await startServer({
    dir: process.cwd(),
    port,
    isDev: false,
    hostname: '127.0.0.1',
    allowRetry: false,
  });
}

try {
  const settingsGet = await requestJson(jar, '/api/settings');
  assert.equal(settingsGet.response.status, 200, 'settings load should succeed');

  const payload = structuredClone(settingsGet.json.settings);
  payload.provider.activeProviderId = 'deepseek';
  payload.provider.activeMode = 'api';
  payload.provider.providers.deepseek.model = 'deepseek-chat';
  payload.provider.providers.deepseek.baseUrl = 'https://api.deepseek.com/v1';
  payload.provider.providers.deepseek.apiKey = 'FAKE_NAV_REGRESSION_KEY';
  payload.privacy.storeApiKeysLocally = true;

  const save = await requestJson(jar, '/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(save.response.status, 200, 'settings save should succeed');
  assert.equal(save.json.settings.provider.activeProviderId, 'deepseek');
  assert.equal(save.json.settings.provider.providers.deepseek.hasStoredApiKey, true);

  const routes = [
    '/zh-CN',
    '/zh-CN/settings',
    '/zh-CN/assistant',
    '/zh-CN/knowledge',
    '/zh-CN/knowledge/graph',
    '/zh-CN/projects/new',
  ];

  for (const pathname of routes) {
    const response = await request(jar, pathname);
    const html = await response.text();
    assert.equal(response.status, 200, `${pathname} should return 200 in ${mode} mode`);
    ensureHtmlLooksHealthy(pathname, html);
    console.log(`[server-nav:${mode}] ${pathname} => 200`);
  }

  const cleared = await requestJson(jar, '/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...save.json.settings,
      provider: {
        ...save.json.settings.provider,
        activeProviderId: 'mock',
        activeMode: 'mock',
        providers: {
          ...save.json.settings.provider.providers,
          deepseek: {
            ...save.json.settings.provider.providers.deepseek,
            apiKey: '',
            clearStoredApiKey: true,
          },
        },
      },
      privacy: {
        ...save.json.settings.privacy,
        storeApiKeysLocally: false,
      },
    }),
  });
  assert.equal(cleared.response.status, 200, 'settings cleanup should succeed');
  assert.equal(cleared.json.settings.provider.providers.deepseek.hasStoredApiKey, false, 'cleanup should clear stored key');

  console.log(`[server-nav:${mode}] cleanup => key cleared`);
} catch (error) {
  exitCode = 1;
  console.error(`[server-nav:${mode}] failed`);
  console.error(error);
} finally {
  if (devProcess) {
    devProcess.kill();
    await delay(500);
    if (!devProcess.killed) {
      devProcess.kill('SIGKILL');
    }
  }
  process.exit(exitCode);
}
