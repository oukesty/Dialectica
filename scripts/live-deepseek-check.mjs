import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { access, readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { startServer } = require('next/dist/server/lib/start-server');

const deepSeekKey = (process.env.DIALECTICA_DEEPSEEK_API_KEY || '').trim();
if (!deepSeekKey) {
  throw new Error('DIALECTICA_DEEPSEEK_API_KEY is required.');
}

process.env.NODE_ENV = 'production';
process.env.NEXT_MANUAL_SIG_HANDLE = '1';

const port = 3212;
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

function logStep(name, detail) {
  console.log(`[live] ${name}: ${detail}`);
}

function buildProjectFromTemplate(template, settings) {
  const stamp = Date.now().toString(36);
  const now = new Date().toISOString();
  const project = structuredClone(template);
  project.id = `project_live_${stamp}`;
  project.title = 'Live DeepSeek Validation Room';
  project.description = 'Temporary room for live DeepSeek validation.';
  project.createdAt = now;
  project.updatedAt = now;
  project.language = 'zh-CN';
  project.entries = [];
  project.nodes = [];
  project.relations = [];
  project.insights.items = [];
  project.summary = {
    ...project.summary,
    overview: 'Waiting for live DeepSeek analysis.',
    participantOverview: [],
    coreTopics: [],
    majorClaims: [],
    keyEvidence: [],
    majorRebuttals: [],
    unresolvedQuestions: [],
    disputes: [],
    currentConclusion: 'No conclusion yet.',
    nextSteps: [],
    suggestions: [],
    followupQuestions: [],
  };

  project.room.id = `room_live_${stamp}`;
  project.room.slug = `live-room-${stamp}`;
  project.room.visibility = 'private';
  project.room.session.id = `session_live_${stamp}`;
  project.room.session.title = 'Live DeepSeek Room';
  project.room.session.goal = project.goal;
  project.room.session.startedAt = now;
  project.room.session.sync.lastEventAt = now;
  project.room.notes = ['Temporary room for live DeepSeek validation.'];

  project.participants = project.participants.slice(0, 1).map((participant) => ({
    ...participant,
    id: `participant_live_host_${stamp}`,
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
    connectionId: `presence_live_host_${stamp}`,
    lastSeenAt: now,
    active: true,
  }];
  project.room.aiConfig = {
    providerId: 'deepseek',
    model: 'deepseek-chat',
    ownerIdentityId: settings.profile.localIdentityId,
    ownerParticipantId: project.participants[0].id,
    updatedAt: now,
    updatedByParticipantId: project.participants[0].id,
  };
  project.providerSnapshot = {
    providerId: 'deepseek',
    model: 'deepseek-chat',
    generatedAt: now,
    version: 'seed',
  };
  return project;
}

function buildSoloProjectFromTemplate(template, settings) {
  const project = buildProjectFromTemplate(template, settings);
  const stamp = Date.now().toString(36);
  const now = new Date().toISOString();
  project.id = `project_live_solo_${stamp}`;
  project.title = "Live DeepSeek Solo Analysis";
  project.description = "Temporary single-user DeepSeek validation project.";
  project.scenario = "ai-dialogue";
  project.goal = "Capture one analyst's prompt, evidence, and AI output in the same workspace.";
  project.tags = ["solo-mode", "ai-dialogue", "live-validation"];
  project.room.id = `room_live_solo_${stamp}`;
  project.room.slug = `live-solo-${stamp}`;
  project.room.visibility = "private";
  project.room.session.id = `session_live_solo_${stamp}`;
  project.room.session.title = "Solo AI Analysis Session";
  project.room.session.goal = project.goal;
  project.room.session.startedAt = now;
  project.room.session.sync.lastEventAt = now;
  project.room.notes = ["Temporary solo DeepSeek validation."];
  project.participants = project.participants.slice(0, 1).map((participant) => ({
    ...participant,
    id: `participant_live_solo_host_${stamp}`,
    name: settings.profile.displayName,
    profileOwnerId: settings.profile.localIdentityId,
    avatarLabel: settings.profile.displayName.slice(0, 2),
    avatarPreset: settings.profile.avatarPreset,
    avatarImageDataUrl: settings.profile.avatarImageDataUrl,
    collaborationRole: "host",
    role: "moderator",
    presence: {
      ...participant.presence,
      status: "online",
      lastSeenAt: now,
      sessionId: project.room.session.id,
    },
  }));
  project.room.session.hostParticipantId = project.participants[0].id;
  project.room.presence = [{
    participantId: project.participants[0].id,
    collaborationRole: "host",
    status: "online",
    sessionId: project.room.session.id,
    deviceLabel: "HOST",
    connectionId: `presence_live_solo_host_${stamp}`,
    lastSeenAt: now,
    active: true,
  }];
  project.room.aiConfig = {
    providerId: "deepseek",
    model: "deepseek-chat",
    ownerIdentityId: settings.profile.localIdentityId,
    ownerParticipantId: project.participants[0].id,
    updatedAt: now,
    updatedByParticipantId: project.participants[0].id,
  };
  project.providerSnapshot = {
    providerId: "deepseek",
    model: "deepseek-chat",
    generatedAt: now,
    version: "seed",
  };
  project.entries = [];
  project.nodes = [];
  project.relations = [];
  project.insights.items = [];
  project.summary = {
    ...project.summary,
    overview: "Waiting for live DeepSeek solo analysis.",
    participantOverview: [],
    coreTopics: [],
    majorClaims: [],
    keyEvidence: [],
    majorRebuttals: [],
    unresolvedQuestions: [],
    disputes: [],
    currentConclusion: "No conclusion yet.",
    nextSteps: [],
    suggestions: [],
    followupQuestions: [],
  };
  return project;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function clearDeepSeekSettings(jar) {
  const current = await requestJson(jar, '/api/settings');
  if (current.response.status !== 200 || !current.json?.settings) {
    throw new Error('Unable to load settings for cleanup.');
  }

  const response = await requestJson(jar, '/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...current.json.settings,
      provider: {
        ...current.json.settings.provider,
        activeProviderId: 'mock',
        activeMode: 'mock',
        providers: {
          ...current.json.settings.provider.providers,
          deepseek: {
            ...current.json.settings.provider.providers.deepseek,
            apiKey: '',
            clearStoredApiKey: true,
          },
        },
      },
      privacy: {
        ...current.json.settings.privacy,
        storeApiKeysLocally: false,
      },
    }),
  });

  if (response.response.status !== 200) {
    throw new Error('Unable to persist DeepSeek cleanup settings.');
  }

  return response;
}

const alice = new CookieJar({ [identityCookie]: 'profile_live_alice' });
const bob = new CookieJar({ [identityCookie]: 'profile_live_bob' });

let exitCode = 0;
const liveProjectIds = [];
let secretPath = '';
let cleanupVerified = false;

await startServer({
  dir: process.cwd(),
  port,
  isDev: false,
  hostname: '127.0.0.1',
  allowRetry: false,
});

try {
  const aliceSettingsGet = await requestJson(alice, '/api/settings');
  assert.equal(aliceSettingsGet.response.status, 200);
  const bobSettingsGet = await requestJson(bob, '/api/settings');
  assert.equal(bobSettingsGet.response.status, 200);

  const aliceConfiguredSettings = {
    ...aliceSettingsGet.json.settings,
    locale: 'zh-CN',
    profile: {
      ...aliceSettingsGet.json.settings.profile,
      displayName: 'Live Alice',
      avatarPreset: 'cobalt',
    },
    provider: {
      ...aliceSettingsGet.json.settings.provider,
      activeProviderId: 'deepseek',
      activeMode: 'api',
      preferServerKeys: false,
      providers: {
        ...aliceSettingsGet.json.settings.provider.providers,
        deepseek: {
          ...aliceSettingsGet.json.settings.provider.providers.deepseek,
          model: 'deepseek-chat',
          baseUrl: 'https://api.deepseek.com/v1',
          apiKey: deepSeekKey,
          clearStoredApiKey: false,
        },
      },
    },
    privacy: {
      ...aliceSettingsGet.json.settings.privacy,
      storeApiKeysLocally: true,
    },
  };

  const aliceSave = await requestJson(alice, '/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(aliceConfiguredSettings),
  });
  assert.equal(aliceSave.response.status, 200);
  assert.equal(aliceSave.json.settings.provider.providers.deepseek.apiKey, '');
  assert.equal(aliceSave.json.settings.provider.providers.deepseek.hasStoredApiKey, true);
  assert.notEqual(aliceSave.json.settings.provider.providers.deepseek.maskedApiKey, deepSeekKey);
  logStep('settings-save', 'DeepSeek config persisted with masked key state');

  const bobSave = await requestJson(bob, '/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...bobSettingsGet.json.settings,
      locale: 'en',
      profile: {
        ...bobSettingsGet.json.settings.profile,
        displayName: 'Live Bob',
        avatarPreset: 'forest',
      },
    }),
  });
  assert.equal(bobSave.response.status, 200);

  const aliceReload = await requestJson(alice, '/api/settings');
  assert.equal(aliceReload.response.status, 200);
  assert.equal(aliceReload.json.settings.provider.activeProviderId, 'deepseek');
  assert.equal(aliceReload.json.settings.provider.providers.deepseek.model, 'deepseek-chat');
  assert.equal(aliceReload.json.settings.provider.providers.deepseek.baseUrl, 'https://api.deepseek.com/v1');
  assert.equal(aliceReload.json.settings.provider.providers.deepseek.apiKey, '');
  assert.equal(aliceReload.json.settings.provider.providers.deepseek.hasStoredApiKey, true);
  secretPath = `data/provider-secrets/${aliceReload.json.settings.profile.localIdentityId}.json`;
  const secretRaw = JSON.parse(await readFile(secretPath, 'utf8'));
  assert.equal(secretRaw.deepseek, deepSeekKey);
  logStep('settings-reload', 'saved state survives reload and secret is stored outside profile JSON');

  const successTest = await requestJson(alice, '/api/providers/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ providerId: 'deepseek', locale: 'en' }),
  });
  assert.equal(successTest.response.status, 200);
  if (!successTest.json.result.ok) {
    throw new Error(`DeepSeek connection test did not succeed: ${successTest.json.result.message}`);
  }
  logStep('connection-ok', successTest.json.result.message);

  const wrongModel = await requestJson(alice, '/api/providers/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      providerId: 'deepseek',
      locale: 'en',
      config: {
        ...aliceReload.json.settings.provider.providers.deepseek,
        model: 'deepseek-not-real',
      },
    }),
  });
  assert.equal(wrongModel.response.status, 400);
  logStep('wrong-model', 'unsupported model rejected before live call');

  const wrongKey = await requestJson(alice, '/api/providers/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      providerId: 'deepseek',
      locale: 'en',
      config: {
        ...aliceReload.json.settings.provider.providers.deepseek,
        apiKey: 'NOT_A_REAL_SECRET_FOR_TESTS',
      },
    }),
  });
  assert.equal(wrongKey.response.status, 200);
  assert.equal(wrongKey.json.result.ok, false);
  logStep('wrong-key', wrongKey.json.result.message);

  const wrongBaseUrl = await requestJson(alice, '/api/providers/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      providerId: 'deepseek',
      locale: 'en',
      config: {
        ...aliceReload.json.settings.provider.providers.deepseek,
        baseUrl: 'https://api.deepseek.com/v9999',
      },
    }),
  });
  assert.equal(wrongBaseUrl.response.status, 200);
  assert.equal(wrongBaseUrl.json.result.ok, false);
  assert.doesNotMatch(wrongBaseUrl.json.result.message, /No API key/i);
  logStep('wrong-base-url', wrongBaseUrl.json.result.message);

  const template = JSON.parse(await readFile('data/projects/project_bd907307339f.json', 'utf8'));
  const liveProjectPayload = buildProjectFromTemplate(template, aliceReload.json.settings);
  const createProject = await requestJson(alice, '/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(liveProjectPayload),
  });
  assert.equal(createProject.response.status, 201);
  const liveProject = createProject.json.project;
  liveProjectIds.push(liveProject.id);
  const hostParticipantId = liveProject.participants[0].id;
  logStep('project-create', liveProject.id);

  const makePublic = await requestJson(alice, `/api/projects/${liveProject.id}/room?locale=zh-CN`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...liveProject.room,
      visibility: 'public',
    }),
  });
  assert.equal(makePublic.response.status, 200);

  const bobJoin = await requestJson(bob, `/api/projects/${liveProject.id}/room?locale=en`, { method: 'POST' });
  assert.equal(bobJoin.response.status, 201);
  const bobParticipantId = bobJoin.json.participant.id;
  logStep('room-join', 'second member joined public room');

  const textForm = new FormData();
  textForm.set('participantId', hostParticipantId);
  textForm.set('note', 'meeting brief');
  textForm.set('file', new File(['Document context: the finance team expects cost neutrality, while engineering wants remote-first flexibility.'], 'brief.txt', { type: 'text/plain' }));
  const textAttachment = await requestJson(alice, `/api/projects/${liveProject.id}/attachments?locale=zh-CN`, {
    method: 'POST',
    body: textForm,
  });
  assert.equal(textAttachment.response.status, 201);

  const imageAttachment = await requestJson(alice, `/api/projects/${liveProject.id}/attachments?locale=zh-CN`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'floor-plan.png',
      kind: 'image',
      mimeType: 'image/png',
      sizeBytes: 2048,
      uploadedByParticipantId: hostParticipantId,
      publicUrl: 'https://example.com/floor-plan.png',
      note: 'Office layout reference',
    }),
  });
  assert.equal(imageAttachment.response.status, 201);
  logStep('attachments', 'document and image context attached');

  const aliceMessage = await requestJson(alice, `/api/projects/${liveProject.id}/events?locale=zh-CN`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'message',
      participantId: hostParticipantId,
      message: '议题：是否在下一季度改为 remote-first。支持方强调跨地域招聘与深度工作，反对方担心新人 onboarding 和跨团队协作成本。',
      kind: 'statement',
      tags: ['remote-first', 'decision'],
      highlighted: true,
    }),
  });
  assert.equal(aliceMessage.response.status, 200);

  const bobMessage = await requestJson(bob, `/api/projects/${liveProject.id}/events?locale=en`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'message',
      participantId: bobParticipantId,
      message: 'I can support a staged rollout if the team defines onboarding metrics, mentorship coverage, and required in-person checkpoints for new hires.',
      kind: 'response',
      tags: ['rollout', 'onboarding'],
      highlighted: true,
    }),
  });
  assert.equal(bobMessage.response.status, 200);
  logStep('discussion', 'multi-party messages recorded in the room timeline');

  const summarizeRun = await requestJson(bob, `/api/projects/${liveProject.id}/ai`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ task: 'summarizeDiscussion', locale: 'en' }),
  });
  assert.equal(summarizeRun.response.status, 200);
  assert.equal(summarizeRun.json.providerId, 'deepseek');
  assert.equal(summarizeRun.json.roomAiConfig.ownerIdentityId, aliceReload.json.settings.profile.localIdentityId);
  assert.ok(summarizeRun.json.analysis.summary.overview.length > 0);
  assert.ok(summarizeRun.json.taskResult.packet.attachments.items.some((item) => item.name === 'brief.txt' && item.previewText.includes('Document context')));
  assert.ok(summarizeRun.json.taskResult.packet.attachments.items.some((item) => item.kind === 'image' && item.publicUrl === 'https://example.com/floor-plan.png'));
  assert.ok(summarizeRun.json.knowledge?.stats.nodeCount > 0);
  assert.ok(summarizeRun.json.knowledge?.stats.relationCount > 0);
  logStep('ai-summary', 'Bob triggered the room AI run and the room still used Alice\'s saved DeepSeek config');

  const followupRun = await requestJson(alice, `/api/projects/${liveProject.id}/ai`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ task: 'generateFollowupQuestions', locale: 'en' }),
  });
  assert.equal(followupRun.response.status, 200);
  assert.ok(followupRun.json.analysis.summary.followupQuestions.length > 0 || followupRun.json.taskResult.output.followupQuestions.length > 0);
  logStep('ai-followup', 'follow-up question generation completed');

  const evaluateRun = await requestJson(alice, `/api/projects/${liveProject.id}/ai`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ task: 'evaluateDiscussion', locale: 'en' }),
  });
  assert.equal(evaluateRun.response.status, 200);
  assert.ok(evaluateRun.json.analysis.summary.evaluation.leaning.length > 0);
  assert.ok(evaluateRun.json.analysis.summary.evaluation.reasons.length > 0 || evaluateRun.json.taskResult.output.evaluation.reasons.length > 0);
  logStep('ai-evaluation', 'discussion evaluation completed');

  const collaborationState = await requestJson(alice, `/api/projects/${liveProject.id}/collaboration?locale=en`);
  assert.equal(collaborationState.response.status, 200);
  assert.ok(collaborationState.json.collaboration.events.some((event) => event.actorType === 'ai' && event.aiTask === 'summarizeDiscussion'));
  assert.ok(collaborationState.json.collaboration.events.some((event) => event.actorType === 'ai' && event.aiTask === 'knowledgeExtraction'));

  const knowledgeSnapshot = await requestJson(alice, `/api/projects/${liveProject.id}/knowledge?locale=en`);
  assert.equal(knowledgeSnapshot.response.status, 200);
  assert.ok(knowledgeSnapshot.json.snapshot.nodes.length > 0);
  assert.ok(knowledgeSnapshot.json.snapshot.relations.length > 0);
  logStep('knowledge-writeback', 'AI outputs reached collaboration history, summary, and knowledge snapshot structures');

  const soloProjectPayload = buildSoloProjectFromTemplate(template, aliceReload.json.settings);
  const soloCreate = await requestJson(alice, '/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(soloProjectPayload),
  });
  assert.equal(soloCreate.response.status, 201);
  const soloProject = soloCreate.json.project;
  liveProjectIds.push(soloProject.id);
  const soloParticipantId = soloProject.participants[0].id;

  const soloTextForm = new FormData();
  soloTextForm.set('participantId', soloParticipantId);
  soloTextForm.set('note', 'solo evidence brief');
  soloTextForm.set('file', new File(['Solo context: compare three provider choices and highlight the strongest argument, weakest evidence, and next question.'], 'solo-brief.txt', { type: 'text/plain' }));
  const soloAttachment = await requestJson(alice, `/api/projects/${soloProject.id}/attachments?locale=zh-CN`, {
    method: 'POST',
    body: soloTextForm,
  });
  assert.equal(soloAttachment.response.status, 201);

  const soloMessage = await requestJson(alice, `/api/projects/${soloProject.id}/events?locale=zh-CN`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'message',
      participantId: soloParticipantId,
      message: '我想把这次讨论当成单用户分析会话来跑：请围绕成本、风险、可落地性和缺失证据来总结。',
      kind: 'statement',
      tags: ['solo-mode', 'analysis'],
      highlighted: true,
    }),
  });
  assert.equal(soloMessage.response.status, 200);

  const soloSummary = await requestJson(alice, `/api/projects/${soloProject.id}/ai`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ task: 'summarizeDiscussion', locale: 'zh-CN' }),
  });
  assert.equal(soloSummary.response.status, 200);
  assert.equal(soloSummary.json.providerId, 'deepseek');
  assert.ok(soloSummary.json.analysis.summary.overview.length > 0);
  assert.ok(soloSummary.json.knowledge?.stats.nodeCount > 0);
  assert.ok(soloSummary.json.taskResult.packet.attachments.items.some((item) => item.name === "solo-brief.txt"));
  const soloWorkspace = await request(alice, `/zh-CN/projects/${soloProject.id}`);
  const soloWorkspaceHtml = await soloWorkspace.text();
  assert.equal(soloWorkspace.status, 200);
  assert.match(soloWorkspaceHtml, /单用户分析/);
  logStep('solo-summary', 'single-user AI dialogue mode produced a real DeepSeek summary with attachment context');

  const clearSettings = await clearDeepSeekSettings(alice);
  assert.equal(clearSettings.response.status, 200);
  const afterClear = await requestJson(alice, '/api/settings');
  assert.equal(afterClear.response.status, 200);
  assert.equal(afterClear.json.settings.provider.providers.deepseek.hasStoredApiKey, false);
  assert.equal(await exists(secretPath), false);
  cleanupVerified = true;
  logStep('settings-clear', 'DeepSeek secret removed from local profile storage');

  const missingKey = await requestJson(alice, '/api/providers/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ providerId: 'deepseek', locale: 'en' }),
  });
  assert.equal(missingKey.response.status, 200);
  assert.equal(missingKey.json.result.ok, false);
  assert.match(missingKey.json.result.message, /No API key/i);
  logStep('missing-key', 'missing credential state now fails cleanly after cleanup');
} catch (error) {
  exitCode = 1;
  console.error('[live] failed');
  console.error(error);
} finally {
  try {
    if (!cleanupVerified) {
      await clearDeepSeekSettings(alice);
      if (secretPath) {
        assert.equal(await exists(secretPath), false);
      }
      logStep('cleanup-fallback', 'DeepSeek secret cleanup executed in finally');
    }
  } catch (cleanupError) {
    exitCode = 1;
    console.error('[live] cleanup-failed');
    console.error(cleanupError);
  }

  try {
    for (const liveProjectId of liveProjectIds.splice(0)) {
      const deleteProject = await request(alice, `/api/projects/${liveProjectId}?locale=zh-CN`, { method: 'DELETE' });
      assert.equal(deleteProject.status, 204);
    }
    if (liveProjectIds.length === 0) {
      logStep('cleanup', 'temporary live validation rooms deleted');
    }
  } catch (cleanupError) {
    exitCode = 1;
    console.error('[live] project-cleanup-failed');
    console.error(cleanupError);
  }

  process.exit(exitCode);
}

