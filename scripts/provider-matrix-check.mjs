import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { startServer } = require('next/dist/server/lib/start-server');

process.env.NODE_ENV = 'production';
process.env.NEXT_MANUAL_SIG_HANDLE = '1';

const port = 3213;
const baseUrl = `http://127.0.0.1:${port}`;
const identityCookie = 'dialectica-profile-id';

class CookieJar {
  constructor(initial = {}) {
    this.cookies = new Map(Object.entries(initial));
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
  const response = await fetch(pathname.startsWith('http') ? pathname : baseUrl + pathname, {
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
  const json = text ? JSON.parse(text) : null;
  return { response, json, text };
}

function fakeKeyFor(providerId) {
  const suffix = 'provider-matrix-key-123456789';
  if (providerId === 'gemini') return `AIza-${suffix}`;
  return `sk-${providerId}-${suffix}`;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function logResult(name, detail) {
  console.log(`[provider-matrix] ${name}: ${detail}`);
}

await startServer({
  dir: process.cwd(),
  port,
  isDev: false,
  hostname: '127.0.0.1',
  allowRetry: false,
});

const jar = new CookieJar({ [identityCookie]: 'profile_provider_matrix' });
let exitCode = 0;

try {
  const initial = await requestJson(jar, '/api/settings');
  assert.equal(initial.response.status, 200);
  const apiProviders = initial.json.settings.provider.descriptors.filter((descriptor) => descriptor.mode === 'api');
  const profileId = initial.json.settings.profile.localIdentityId;
  const secretFile = `data/provider-secrets/${profileId}.json`;

  for (const descriptor of apiProviders) {
    const current = await requestJson(jar, '/api/settings');
    assert.equal(current.response.status, 200);
    const runtime = current.json.settings.provider.providers[descriptor.id];
    const fakeKey = fakeKeyFor(descriptor.id);
    const prepared = {
      ...current.json.settings,
      provider: {
        ...current.json.settings.provider,
        activeProviderId: descriptor.id,
        activeMode: 'api',
        providers: {
          ...current.json.settings.provider.providers,
          [descriptor.id]: {
            ...runtime,
            apiKey: fakeKey,
            clearStoredApiKey: false,
          },
        },
      },
      privacy: {
        ...current.json.settings.privacy,
        storeApiKeysLocally: true,
      },
    };

    const saved = await requestJson(jar, '/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(prepared),
    });
    assert.equal(saved.response.status, 200);
    assert.equal(saved.json.settings.provider.activeProviderId, descriptor.id);
    assert.equal(saved.json.settings.provider.providers[descriptor.id].apiKey, '');
    assert.equal(saved.json.settings.provider.providers[descriptor.id].hasStoredApiKey, true);
    assert.notEqual(saved.json.settings.provider.providers[descriptor.id].maskedApiKey, fakeKey);
    assert.equal(saved.json.settings.provider.providers[descriptor.id].baseUrl, runtime.baseUrl);
    assert.equal(saved.json.settings.provider.providers[descriptor.id].model, runtime.model);

    const reload = await requestJson(jar, '/api/settings');
    assert.equal(reload.response.status, 200);
    assert.equal(reload.json.settings.provider.providers[descriptor.id].hasStoredApiKey, true);
    assert.equal(reload.json.settings.provider.providers[descriptor.id].apiKey, '');
    logResult(`${descriptor.id}-save`, 'saved state persisted with masked key');

    const invalidModel = await requestJson(jar, '/api/providers/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providerId: descriptor.id,
        locale: 'en',
        config: {
          ...reload.json.settings.provider.providers[descriptor.id],
          model: `${descriptor.id}-not-a-real-model`,
        },
      }),
    });
    assert.equal(invalidModel.response.status, 400);
    logResult(`${descriptor.id}-model`, 'unsupported model is rejected clearly');

    const testConnection = await requestJson(jar, '/api/providers/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: descriptor.id, locale: 'en' }),
    });
    assert.equal(testConnection.response.status, 200);
    assert.doesNotMatch(testConnection.json.result.message, /No API key/i);
    logResult(`${descriptor.id}-test`, `${testConnection.json.result.ok ? 'ready' : 'handled'} -> ${testConnection.json.result.message}`);

    const cleared = await requestJson(jar, '/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...reload.json.settings,
        privacy: {
          ...reload.json.settings.privacy,
          storeApiKeysLocally: false,
        },
        provider: {
          ...reload.json.settings.provider,
          providers: {
            ...reload.json.settings.provider.providers,
            [descriptor.id]: {
              ...reload.json.settings.provider.providers[descriptor.id],
              apiKey: '',
              clearStoredApiKey: true,
            },
          },
        },
      }),
    });
    assert.equal(cleared.response.status, 200);

    const afterClear = await requestJson(jar, '/api/settings');
    assert.equal(afterClear.response.status, 200);
    assert.equal(afterClear.json.settings.provider.providers[descriptor.id].hasStoredApiKey, false);
    logResult(`${descriptor.id}-clear`, 'stored key cleared cleanly');
  }

  assert.equal(await exists(secretFile), false);
  logResult('cleanup', 'provider secret storage is empty after matrix validation');
} catch (error) {
  exitCode = 1;
  console.error('[provider-matrix] failed');
  console.error(error);
} finally {
  process.exit(exitCode);
}
