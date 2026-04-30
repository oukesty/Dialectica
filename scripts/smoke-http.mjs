import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { startServer } = require('next/dist/server/lib/start-server');

process.env.NODE_ENV = 'production';
process.env.NEXT_MANUAL_SIG_HANDLE = '1';

const port = 3210;
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

function logResult(results, name, detail) {
  results.push({ name, detail });
  console.log(`[smoke] ${name}: ${detail}`);
}

function buildProjectFromTemplate(template, settings) {
  const stamp = Date.now().toString(36);
  const now = new Date().toISOString();
  const project = structuredClone(template);
  project.id = `project_smoke_${stamp}`;
  project.title = 'Smoke Validation Room';
  project.description = 'Temporary room for production smoke validation.';
  project.createdAt = now;
  project.updatedAt = now;
  project.language = settings.locale;
  project.entries = [];
  project.nodes = [];
  project.relations = [];
  project.insights.items = [];
  project.summary = {
    ...project.summary,
    overview: settings.locale === 'zh-CN' ? '等待首轮发言与 AI 分析。' : settings.locale === 'ja' ? '最初の発言と AI 分析を待っています。' : settings.locale === 'fr' ? 'En attente des premiers messages et de l analyse IA.' : 'Waiting for the first messages and AI analysis.',
    participantOverview: [],
    coreTopics: [],
    majorClaims: [],
    keyEvidence: [],
    majorRebuttals: [],
    unresolvedQuestions: [],
    disputes: [],
    currentConclusion: settings.locale === 'zh-CN' ? '尚无结论。' : settings.locale === 'ja' ? 'まだ結論はありません。' : settings.locale === 'fr' ? 'Aucune conclusion pour l instant.' : 'No conclusion yet.',
    nextSteps: [],
    suggestions: [],
    followupQuestions: [],
    evaluation: {
      ...project.summary.evaluation,
      leaning: settings.locale === 'zh-CN' ? '待分析' : settings.locale === 'ja' ? '未分析' : settings.locale === 'fr' ? 'A analyser' : 'Pending',
      favoredByEvidence: settings.locale === 'zh-CN' ? '待分析' : settings.locale === 'ja' ? '未分析' : settings.locale === 'fr' ? 'A analyser' : 'Pending',
      favoredByResponsiveness: settings.locale === 'zh-CN' ? '待分析' : settings.locale === 'ja' ? '未分析' : settings.locale === 'fr' ? 'A analyser' : 'Pending',
      favoredByLogic: settings.locale === 'zh-CN' ? '待分析' : settings.locale === 'ja' ? '未分析' : settings.locale === 'fr' ? 'A analyser' : 'Pending',
      moreUnanswered: settings.locale === 'zh-CN' ? '待分析' : settings.locale === 'ja' ? '未分析' : settings.locale === 'fr' ? 'A analyser' : 'Pending',
      confidence: settings.locale === 'zh-CN' ? '低' : settings.locale === 'ja' ? '低' : settings.locale === 'fr' ? 'Faible' : 'Low',
      reasons: [],
      improvementSuggestions: [],
    },
  };

  project.room.id = `room_smoke_${stamp}`;
  project.room.slug = `smoke-room-${stamp}`;
  project.room.visibility = 'private';
  project.room.session.id = `session_smoke_${stamp}`;
  project.room.session.title = settings.locale === 'zh-CN' ? 'Smoke 验证房间' : settings.locale === 'ja' ? 'Smoke 検証ルーム' : settings.locale === 'fr' ? 'Salle de validation smoke' : 'Smoke validation room';
  project.room.session.goal = project.goal;
  project.room.session.startedAt = now;
  project.room.session.sync.lastEventAt = now;
  project.room.notes = [settings.locale === 'zh-CN' ? '用于生产 smoke 验证。' : settings.locale === 'ja' ? '本番 smoke 検証用です。' : settings.locale === 'fr' ? 'Utilisee pour la validation smoke de production.' : 'Used for production smoke validation.'];

  project.participants = project.participants.slice(0, 1).map((participant) => ({
    ...participant,
    id: `participant_smoke_host_${stamp}`,
    name: settings.profile.displayName,
    profileOwnerId: settings.profile.localIdentityId,
    avatarLabel: settings.profile.displayName.slice(0, 2),
    avatarPreset: settings.profile.avatarPreset,
    avatarImageDataUrl: settings.profile.avatarImageDataUrl,
    presence: {
      ...participant.presence,
      status: 'online',
      lastSeenAt: now,
      sessionId: project.room.session.id,
    },
  }));

  project.room.session.hostParticipantId = project.participants[0].id;
  project.room.presence = [{
    participantId: project.participants[0].id,
    collaborationRole: 'host',
    status: 'online',
    sessionId: project.room.session.id,
    deviceLabel: 'HOST',
    connectionId: `presence_smoke_host_${stamp}`,
    lastSeenAt: now,
    active: true,
  }];
  project.room.aiConfig = {
    providerId: settings.provider.activeProviderId,
    model: settings.provider.providers[settings.provider.activeProviderId].model,
    ownerIdentityId: settings.profile.localIdentityId,
    ownerParticipantId: project.participants[0].id,
    updatedAt: now,
    updatedByParticipantId: project.participants[0].id,
  };
  project.providerSnapshot.generatedAt = now;
  return project;
}

const results = [];
let exitCode = 0;

try {
  await startServer({
    dir: process.cwd(),
    port,
    isDev: false,
    hostname: '127.0.0.1',
    allowRetry: false,
  });

  const alice = new CookieJar({ [identityCookie]: 'profile_smoke_alice' });
  const bob = new CookieJar({ [identityCookie]: 'profile_smoke_bob' });
  const charlie = new CookieJar({ [identityCookie]: 'profile_smoke_charlie' });

  for (const locale of ['zh-CN', 'en', 'fr', 'ja']) {
    const response = await request(alice, `/${locale}`);
    const html = await response.text();
    assert.equal(response.status, 200, `homepage ${locale} should return 200`);
    assert.match(html, /Dialectica/i);
    logResult(results, `locale-${locale}`, 'homepage 200');
  }

  const zhHomepage = await request(alice, '/zh-CN');
  const zhHomepageHtml = await zhHomepage.text();
  assert.equal(zhHomepage.status, 200);
  assert.doesNotMatch(zhHomepageHtml, /lucide-refresh-ccw/);

  const zhNewProject = await request(alice, '/zh-CN/projects/new');
  const zhNewProjectHtml = await zhNewProject.text();
  assert.equal(zhNewProject.status, 200);
  assert.doesNotMatch(zhNewProjectHtml, /lucide-refresh-ccw/);

  const zhAssistant = await request(alice, '/zh-CN/assistant');
  const zhAssistantHtml = await zhAssistant.text();
  assert.equal(zhAssistant.status, 200);
  assert.match(zhAssistantHtml, /个人 AI 工作台|Personal AI Workspace|assistant/i);

  const zhSoloRedirect = await request(alice, '/zh-CN/projects/new?mode=solo');
  assert.ok([307, 308].includes(zhSoloRedirect.status), 'solo mode entry should redirect to assistant workspace');
  assert.equal(zhSoloRedirect.headers.get('location'), '/zh-CN/assistant/new');

  assert.ok(zhHomepageHtml.includes('/zh-CN/settings'));
  assert.ok(zhHomepageHtml.includes('/zh-CN/projects/new'));
  assert.ok(zhHomepageHtml.includes('/zh-CN/assistant'));

  logResult(results, 'refresh-logic', 'manual refresh actions removed and assistant workspace entry is available from production pages');

  for (const path of ['/zh-CN/settings', '/en/settings', '/fr/settings', '/ja/settings', '/zh-CN/knowledge', '/zh-CN/knowledge/graph']) {
    const response = await request(alice, path);
    assert.equal(response.status, 200, `${path} should return 200`);
    logResult(results, path, 'page 200');
    await response.arrayBuffer();
  }

  const aliceSettingsGet = await requestJson(alice, '/api/settings');
  assert.equal(aliceSettingsGet.response.status, 200);
  const bobSettingsGet = await requestJson(bob, '/api/settings');
  assert.equal(bobSettingsGet.response.status, 200);

  const aliceAvatar = 'data:image/png;base64,AAAA';
  const bobAvatar = 'data:image/png;base64,BBBB';
  const fakeDeepSeekKey = 'DUMMY_PROVIDER_KEY_FOR_TESTS';

  const aliceConfiguredSettings = {
    ...aliceSettingsGet.json.settings,
    locale: 'zh-CN',
    theme: 'system',
    defaultScenario: 'meeting',
    defaultExportFormat: 'json',
    profile: {
      ...aliceSettingsGet.json.settings.profile,
      displayName: 'Smoke Alice',
      avatarPreset: 'aurora',
      avatarImageDataUrl: aliceAvatar,
    },
    appearancePreferences: {
      ...aliceSettingsGet.json.settings.appearancePreferences,
      themePreset: 'paper',
      reduceMotion: true,
      customThemeName: 'Smoke Theme',
      customTheme: {
        light: { primary: '#1f5f8b', secondary: '#5b8c66', accent: '#c68f4a' },
        dark: { primary: '#1d3557', secondary: '#457b9d', accent: '#e9c46a' },
      },
    },
    provider: {
      ...aliceSettingsGet.json.settings.provider,
      mockEmphasis: 'evidence',
      providers: {
        ...aliceSettingsGet.json.settings.provider.providers,
        deepseek: {
          ...aliceSettingsGet.json.settings.provider.providers.deepseek,
          model: 'deepseek-chat',
          baseUrl: 'https://api.deepseek.com/v1',
          apiKey: fakeDeepSeekKey,
          clearStoredApiKey: false,
        },
      },
    },
    discussionPreferences: {
      ...aliceSettingsGet.json.settings.discussionPreferences,
      defaultWorkspaceTab: 'knowledge',
    },
    collaborationPreferences: {
      ...aliceSettingsGet.json.settings.collaborationPreferences,
      allowInvites: false,
      syncPollingMs: 6000,
      eventHistoryLimit: 60,
    },
    knowledgePreferences: {
      ...aliceSettingsGet.json.settings.knowledgePreferences,
      defaultView: 'graph',
    },
    uploadPreferences: {
      ...aliceSettingsGet.json.settings.uploadPreferences,
      allowImages: false,
      maxUploadMb: 16,
    },
    privacy: {
      ...aliceSettingsGet.json.settings.privacy,
      analyticsMode: 'manual-export',
      storeApiKeysLocally: true,
    },
  };

  const alicePut = await requestJson(alice, '/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(aliceConfiguredSettings),
  });
  assert.equal(alicePut.response.status, 200);
  assert.equal(alicePut.json.settings.profile.displayName, 'Smoke Alice');
  assert.equal(alicePut.json.settings.profile.avatarImageDataUrl, aliceAvatar);

  const bobPut = await requestJson(bob, '/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...bobSettingsGet.json.settings,
      locale: 'en',
      profile: {
        ...bobSettingsGet.json.settings.profile,
        displayName: 'Smoke Bob',
        avatarPreset: 'forest',
        avatarImageDataUrl: bobAvatar,
      },
      provider: {
        ...bobSettingsGet.json.settings.provider,
        mockEmphasis: 'responsiveness',
      },
    }),
  });
  assert.equal(bobPut.response.status, 200);

  const aliceReload = await requestJson(alice, '/api/settings');
  const bobReload = await requestJson(bob, '/api/settings');
  assert.equal(aliceReload.json.settings.profile.displayName, 'Smoke Alice');
  assert.equal(aliceReload.json.settings.profile.avatarImageDataUrl, aliceAvatar);
  assert.equal(aliceReload.json.settings.appearancePreferences.themePreset, 'paper');
  assert.equal(aliceReload.json.settings.appearancePreferences.reduceMotion, true);
  assert.equal(aliceReload.json.settings.defaultScenario, 'meeting');
  assert.equal(aliceReload.json.settings.defaultExportFormat, 'json');
  assert.equal(aliceReload.json.settings.provider.mockEmphasis, 'evidence');
  assert.equal(aliceReload.json.settings.provider.providers.deepseek.apiKey, '');
  assert.equal(aliceReload.json.settings.provider.providers.deepseek.hasStoredApiKey, true);
  assert.notEqual(aliceReload.json.settings.provider.providers.deepseek.maskedApiKey, fakeDeepSeekKey);
  assert.equal(bobReload.json.settings.provider.mockEmphasis, 'responsiveness');
  assert.equal(aliceReload.json.settings.discussionPreferences.defaultWorkspaceTab, 'knowledge');
  assert.equal(aliceReload.json.settings.collaborationPreferences.allowInvites, false);
  assert.equal(aliceReload.json.settings.collaborationPreferences.syncPollingMs, 6000);
  assert.equal(aliceReload.json.settings.collaborationPreferences.eventHistoryLimit, 60);
  assert.equal(aliceReload.json.settings.knowledgePreferences.defaultView, 'graph');
  assert.equal(aliceReload.json.settings.uploadPreferences.allowImages, false);
  assert.equal(aliceReload.json.settings.uploadPreferences.maxUploadMb, 16);
  assert.equal(aliceReload.json.settings.privacy.analyticsMode, 'manual-export');
  assert.equal(bobReload.json.settings.profile.displayName, 'Smoke Bob');
  assert.equal(bobReload.json.settings.profile.avatarImageDataUrl, bobAvatar);
  assert.notEqual(aliceReload.json.settings.profile.localIdentityId, bobReload.json.settings.profile.localIdentityId);

  const aliceSettingsPage = await request(alice, '/zh-CN/settings');
  const aliceSettingsPageHtml = await aliceSettingsPage.text();
  assert.equal(aliceSettingsPage.status, 200);
  assert.match(aliceSettingsPageHtml, /当前使用自定义头像/);
  assert.ok(/disabled=\"\"/.test(aliceSettingsPageHtml) || /aria-disabled=\"true\"/.test(aliceSettingsPageHtml));
  assert.match(aliceSettingsPageHtml, /MIT/);
  assert.doesNotMatch(aliceSettingsPageHtml, /github\.com\/your-org\/dialectica/i);
  logResult(results, 'settings-avatar-state', 'custom avatar disables default preset selection until removal');
  logResult(results, 'about-panel', 'MIT license is visible and repository placeholder URL is hidden');

  logResult(results, 'settings-persist', 'language, appearance, provider, collaboration, knowledge, upload, and privacy settings persisted');

  for (const path of ['/zh-CN', '/zh-CN/knowledge', '/zh-CN/knowledge/graph', '/zh-CN/projects/new']) {
    const response = await request(alice, path);
    assert.equal(response.status, 200, `${path} should still open after saving settings`);
    await response.arrayBuffer();
  }
  logResult(results, 'settings-post-save-nav', 'production pages still open normally after saving settings');

  const knowledgeRedirect = await request(alice, '/zh-CN/knowledge');
  assert.ok([307, 308].includes(knowledgeRedirect.status));
  assert.ok((knowledgeRedirect.headers.get('location') ?? '').includes('/zh-CN/knowledge/graph'));
  logResult(results, 'settings-knowledge-view', 'knowledge default view redirected to graph');

  const aliceProfilePath = `data/profiles/${aliceReload.json.settings.profile.localIdentityId}.json`;
  const bobProfilePath = `data/profiles/${bobReload.json.settings.profile.localIdentityId}.json`;
  const aliceSecretPath = `data/provider-secrets/${aliceReload.json.settings.profile.localIdentityId}.json`;
  const aliceProfileRaw = JSON.parse(await readFile(aliceProfilePath, 'utf8'));
  const bobProfileRaw = JSON.parse(await readFile(bobProfilePath, 'utf8'));
  const aliceSecretsRaw = JSON.parse(await readFile(aliceSecretPath, 'utf8'));
  assert.equal(aliceProfileRaw.profile.displayName, 'Smoke Alice');
  assert.equal(bobProfileRaw.profile.displayName, 'Smoke Bob');
  assert.equal(aliceProfileRaw.provider.providers.deepseek.apiKey, '');
  assert.equal(aliceSecretsRaw.deepseek, fakeDeepSeekKey);
  logResult(results, 'profiles', 'avatar persistence, secret masking, and per-user isolation verified');

  const bobEphemeralSave = await requestJson(bob, '/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...bobReload.json.settings,
      provider: {
        ...bobReload.json.settings.provider,
        activeProviderId: 'deepseek',
        providers: {
          ...bobReload.json.settings.provider.providers,
          deepseek: {
            ...bobReload.json.settings.provider.providers.deepseek,
            model: 'deepseek-chat',
            baseUrl: 'https://api.deepseek.com/v1',
            apiKey: 'DUMMY_BOB_EPHEMERAL_KEY_FOR_TESTS',
            clearStoredApiKey: false,
          },
        },
      },
      privacy: {
        ...bobReload.json.settings.privacy,
        storeApiKeysLocally: false,
      },
    }),
  });
  assert.equal(bobEphemeralSave.response.status, 200);
  assert.equal(bobEphemeralSave.json.settings.privacy.storeApiKeysLocally, false);
  assert.equal(bobEphemeralSave.json.settings.provider.providers.deepseek.hasStoredApiKey, false);
  const bobEphemeralReload = await requestJson(bob, '/api/settings');
  assert.equal(bobEphemeralReload.json.settings.privacy.storeApiKeysLocally, false);
  assert.equal(bobEphemeralReload.json.settings.provider.providers.deepseek.hasStoredApiKey, false);
  logResult(results, 'settings-key-retention', 'api keys are not persisted when local retention is disabled');

  const template = JSON.parse(await readFile('data/projects/project_bd907307339f.json', 'utf8'));
  const smokeProjectPayload = buildProjectFromTemplate(template, aliceReload.json.settings);
  const createProject = await requestJson(alice, '/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(smokeProjectPayload),
  });
  assert.equal(createProject.response.status, 201);
  const smokeProject = createProject.json.project;
  const hostParticipantId = smokeProject.participants[0].id;
  logResult(results, 'project-create', smokeProject.id);

  const aliceProjectGet = await requestJson(alice, `/api/projects/${smokeProject.id}?locale=zh-CN`);
  assert.equal(aliceProjectGet.response.status, 200);
  assert.equal(aliceProjectGet.json.project.participants[0].name, 'Smoke Alice');

  const bobPrivateGet = await requestJson(bob, `/api/projects/${smokeProject.id}?locale=en`);
  assert.equal(bobPrivateGet.response.status, 404);
  logResult(results, 'private-room', 'non-member blocked before visibility change');

  const privateInviteAttempt = await requestJson(alice, `/api/projects/${smokeProject.id}/invites?locale=zh-CN`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'participant', createdByParticipantId: hostParticipantId, expiresInHours: 2 }),
  });
  assert.equal(privateInviteAttempt.response.status, 403);

  const publicRoom = structuredClone(smokeProject.room);
  publicRoom.visibility = 'public';
  const makePublic = await requestJson(alice, `/api/projects/${smokeProject.id}/room?locale=zh-CN`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(publicRoom),
  });
  assert.equal(makePublic.response.status, 200);
  logResult(results, 'public-room', 'host switched visibility to public');

  const inviteBlockedBySettings = await requestJson(alice, `/api/projects/${smokeProject.id}/invites?locale=zh-CN`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'participant', createdByParticipantId: hostParticipantId, expiresInHours: 2 }),
  });
  assert.equal(inviteBlockedBySettings.response.status, 403);
  logResult(results, 'settings-invites', 'invite creation blocked while allowInvites is disabled');

  const aliceEnableInvites = await requestJson(alice, '/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...aliceReload.json.settings,
      collaborationPreferences: {
        ...aliceReload.json.settings.collaborationPreferences,
        allowInvites: true,
      },
    }),
  });
  assert.equal(aliceEnableInvites.response.status, 200);

  const bobPublicGet = await requestJson(bob, `/api/projects/${smokeProject.id}/room?locale=en`);
  assert.equal(bobPublicGet.response.status, 200);
  assert.equal(bobPublicGet.json.access.canJoinPublicRoom, true);

  const bobJoin = await requestJson(bob, `/api/projects/${smokeProject.id}/room?locale=en`, { method: 'POST' });
  assert.equal(bobJoin.response.status, 201);
  const bobParticipantId = bobJoin.json.participant.id;
  logResult(results, 'public-join', bobJoin.json.participant.name);

  const messagePost = await requestJson(alice, `/api/projects/${smokeProject.id}/events?locale=zh-CN`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'message',
      participantId: hostParticipantId,
      message: 'Smoke message with attachment context incoming.',
      kind: 'statement',
      tags: ['smoke', 'sync'],
      highlighted: true,
    }),
  });
  assert.equal(messagePost.response.status, 200);

  const bobEvents = await requestJson(bob, `/api/projects/${smokeProject.id}/events?locale=en`);
  assert.equal(bobEvents.response.status, 200);
  assert.ok(bobEvents.json.events.some((event) => event.message.includes('Smoke message with attachment context incoming.')));
  logResult(results, 'events-sync', `${bobEvents.json.events.length} events visible to second user`);

  const bobPresence = await requestJson(bob, `/api/projects/${smokeProject.id}/events?locale=en`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'presence', participantId: bobParticipantId, status: 'syncing', isTyping: true }),
  });
  assert.equal(bobPresence.response.status, 200);

  const bobLeaving = await requestJson(bob, `/api/projects/${smokeProject.id}/events?locale=en`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'presence', participantId: bobParticipantId, status: 'leaving', isTyping: false }),
  });
  assert.equal(bobLeaving.response.status, 200);
  assert.ok(bobLeaving.json.project.participants.some((participant) => participant.id === bobParticipantId && participant.presence.status === 'leaving'));
  logResult(results, 'presence-update', 'participant presence updated through syncing and leaving states');

  const inviteCreate = await requestJson(alice, `/api/projects/${smokeProject.id}/invites?locale=zh-CN`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'participant', createdByParticipantId: hostParticipantId, expiresInHours: 2, note: 'smoke invite' }),
  });
  assert.equal(inviteCreate.response.status, 201);
  const inviteToken = inviteCreate.json.invite.token;

  const inviteRoom = structuredClone(makePublic.json.room);
  inviteRoom.visibility = 'invite';
  const switchInvite = await requestJson(alice, `/api/projects/${smokeProject.id}/room?locale=zh-CN`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(inviteRoom),
  });
  assert.equal(switchInvite.response.status, 200);

  const charlieBeforeInvite = await requestJson(charlie, `/api/projects/${smokeProject.id}/room?locale=fr`);
  assert.equal(charlieBeforeInvite.response.status, 404);

  const charlieAccept = await requestJson(charlie, `/api/projects/${smokeProject.id}/invites/accept`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: inviteToken, name: 'Smoke Charlie', stance: 'Invite path validation' }),
  });
  assert.equal(charlieAccept.response.status, 201);
  logResult(results, 'invite-accept', charlieAccept.json.participant.name);

  const textForm = new FormData();
  textForm.set('participantId', hostParticipantId);
  textForm.set('note', 'smoke local note');
  textForm.set('file', new File(['Local attachment for smoke validation.'], 'evidence-note.txt', { type: 'text/plain' }));
  const localAttachmentPost = await requestJson(alice, `/api/projects/${smokeProject.id}/attachments?locale=zh-CN`, {
    method: 'POST',
    body: textForm,
  });
  assert.equal(localAttachmentPost.response.status, 201);
  const localAttachment = localAttachmentPost.json.attachment;

  const blockedImagePost = await requestJson(alice, `/api/projects/${smokeProject.id}/attachments?locale=zh-CN`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'diagram.png',
      kind: 'image',
      mimeType: 'image/png',
      sizeBytes: 2048,
      uploadedByParticipantId: hostParticipantId,
      publicUrl: 'https://example.com/diagram.png',
      note: 'external image',
    }),
  });
  assert.equal(blockedImagePost.response.status, 400);
  logResult(results, 'settings-uploads', 'image upload blocked while image attachments are disabled');

  const aliceEnableImages = await requestJson(alice, '/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...aliceEnableInvites.json.settings,
      uploadPreferences: {
        ...aliceEnableInvites.json.settings.uploadPreferences,
        allowImages: true,
      },
    }),
  });
  assert.equal(aliceEnableImages.response.status, 200);

  const externalImagePost = await requestJson(alice, `/api/projects/${smokeProject.id}/attachments?locale=zh-CN`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'diagram.png',
      kind: 'image',
      mimeType: 'image/png',
      sizeBytes: 2048,
      uploadedByParticipantId: hostParticipantId,
      publicUrl: 'https://example.com/diagram.png',
      note: 'external image',
    }),
  });
  assert.equal(externalImagePost.response.status, 201);

  const externalVideoPost = await requestJson(alice, `/api/projects/${smokeProject.id}/attachments?locale=zh-CN`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'walkthrough.mp4',
      kind: 'video',
      mimeType: 'video/mp4',
      sizeBytes: 4096,
      uploadedByParticipantId: hostParticipantId,
      publicUrl: 'https://example.com/walkthrough.mp4',
      note: 'external video',
    }),
  });
  assert.equal(externalVideoPost.response.status, 201);

  const attachmentList = await requestJson(alice, `/api/projects/${smokeProject.id}/attachments?locale=zh-CN`);
  assert.equal(attachmentList.response.status, 200);
  assert.ok(attachmentList.json.attachments.some((item) => item.id === localAttachment.id && item.previewText.includes('Local attachment')));
  assert.ok(attachmentList.json.attachments.some((item) => item.kind === 'image'));
  assert.ok(attachmentList.json.attachments.some((item) => item.kind === 'video'));
  logResult(results, 'attachments', `${attachmentList.json.attachments.length} attachments listed`);

  const localAttachmentFetch = await request(alice, `/api/projects/${smokeProject.id}/attachments/${localAttachment.id}`);
  assert.equal(localAttachmentFetch.status, 200);
  const localAttachmentText = await localAttachmentFetch.text();
  assert.match(localAttachmentText, /Local attachment for smoke validation/);
  logResult(results, 'attachment-open', 'local attachment route 200');

  const aiRun = await requestJson(bob, `/api/projects/${smokeProject.id}/ai`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ task: 'summarizeDiscussion', locale: 'en' }),
  });
  assert.equal(aiRun.response.status, 200);
  assert.equal(aiRun.json.roomAiConfig.ownerIdentityId, aliceReload.json.settings.profile.localIdentityId);
  assert.equal(aiRun.json.roomAiConfig.providerId, 'mock');
  assert.ok(aiRun.json.taskResult.packet.attachments.total >= 3);
  assert.equal(aiRun.json.analysis.providerSnapshot.version, 'mock-evidence');
  assert.ok(aiRun.json.taskResult.packet.attachments.items.some((item) => item.id === localAttachment.id && item.previewText.includes('Local attachment')));
  assert.ok(aiRun.json.taskResult.packet.attachments.items.some((item) => typeof item.publicUrl === 'string' && item.publicUrl.includes(`/api/projects/${smokeProject.id}/attachments/`)));
  assert.ok(aiRun.json.taskResult.output.summary.length > 0);
  assert.ok(aiRun.json.analysis.summary.overview.length > 0 || aiRun.json.analysis.summary.currentConclusion.length > 0);
  assert.ok(aiRun.json.knowledge?.stats.nodeCount > 0);
  assert.ok(aiRun.json.knowledge?.stats.relationCount > 0);

  const knowledgeAfterAi = await requestJson(alice, `/api/projects/${smokeProject.id}/knowledge?locale=zh-CN`);
  assert.equal(knowledgeAfterAi.response.status, 200);
  assert.ok(knowledgeAfterAi.json.snapshot.nodes.length > 0);
  assert.ok(knowledgeAfterAi.json.snapshot.relations.length > 0);
  logResult(results, 'ai-context', 'AI packet includes attachment context and uses the room owner mock emphasis instead of the caller settings');
  logResult(results, 'ai-knowledge', 'AI analysis updated summary and persisted a knowledge snapshot with relations');

  const aliceCleanupSettings = await requestJson(alice, '/api/settings');
  assert.equal(aliceCleanupSettings.response.status, 200);
  const clearAliceProviderSecret = await requestJson(alice, '/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...aliceCleanupSettings.json.settings,
      privacy: {
        ...aliceCleanupSettings.json.settings.privacy,
        storeApiKeysLocally: false,
      },
      provider: {
        ...aliceCleanupSettings.json.settings.provider,
        providers: {
          ...aliceCleanupSettings.json.settings.provider.providers,
          deepseek: {
            ...aliceCleanupSettings.json.settings.provider.providers.deepseek,
            apiKey: '',
            clearStoredApiKey: true,
          },
        },
      },
    }),
  });
  assert.equal(clearAliceProviderSecret.response.status, 200);
  const aliceAfterClear = await requestJson(alice, '/api/settings');
  assert.equal(aliceAfterClear.response.status, 200);
  assert.equal(aliceAfterClear.json.settings.provider.providers.deepseek.hasStoredApiKey, false);
  logResult(results, 'provider-secret-cleanup', 'saved provider secret cleared after validation');

  for (const path of [
    `/zh-CN/projects/${smokeProject.id}`,
    `/zh-CN/projects/${smokeProject.id}/report`,
    `/zh-CN/knowledge?projectId=${smokeProject.id}`,
    '/zh-CN/knowledge/n_zh_q1',
    '/zh-CN/knowledge/graph',
  ]) {
    const response = await request(alice, path);
    assert.equal(response.status, 200, `${path} should return 200`);
    await response.arrayBuffer();
    logResult(results, path, 'page 200');
  }

  const deleteProject = await request(alice, `/api/projects/${smokeProject.id}?locale=zh-CN`, { method: 'DELETE' });
  assert.equal(deleteProject.status, 204);
  logResult(results, 'cleanup', 'temporary smoke project deleted');

  console.log('\n[smoke] summary');
  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  exitCode = 1;
  console.error('[smoke] failed');
  console.error(error);
} finally {
  process.exit(exitCode);
}













