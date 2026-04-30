import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { startServer } = require('next/dist/server/lib/start-server');

process.env.NODE_ENV = 'production';
process.env.NEXT_MANUAL_SIG_HANDLE = '1';

const port = 3217;
const baseUrl = `http://127.0.0.1:${port}`;
const identityCookie = 'dialectica-profile-id';
const dataRoot = path.join(process.cwd(), 'data');

class CookieJar {
  constructor(initial = {}) {
    this.cookies = new Map(Object.entries(initial));
  }

  apply(headers = new Headers()) {
    if (this.cookies.size) {
      headers.set('cookie', Array.from(this.cookies.entries()).map(([key, value]) => `${key}=${value}`).join('; '));
    }
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
  const response = await fetch(baseUrl + pathname, {
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

async function removeIfExists(target, options = {}) {
  try {
    await rm(target, { force: true, recursive: true, ...options });
  } catch {
    // ignore cleanup misses
  }
}

async function fileExists(target) {
  try {
    await readFile(target, 'utf8');
    return true;
  } catch {
    return false;
  }
}

async function cleanupProjectArtifacts(projectId) {
  await Promise.all([
    removeIfExists(path.join(dataRoot, 'projects', `${projectId}.json`)),
    removeIfExists(path.join(dataRoot, 'collaboration', `${projectId}.json`)),
    removeIfExists(path.join(dataRoot, 'uploads', projectId), { recursive: true }),
  ]);

  try {
    const knowledgeFiles = await readdir(path.join(dataRoot, 'knowledge'));
    await Promise.all(
      knowledgeFiles
        .filter((file) => file.startsWith(`${projectId}.`))
        .map((file) => removeIfExists(path.join(dataRoot, 'knowledge', file))),
    );
  } catch {
    // ignore missing knowledge directory
  }
}

function buildSoloProject(template, settings) {
  const stamp = Date.now().toString(36);
  const now = new Date().toISOString();
  const project = structuredClone(template);
  project.id = `project_assistant_smoke_${stamp}`;
  project.title = '个人 AI 工作台';
  project.description = '';
  project.scenario = 'ai-dialogue';
  project.goal = '围绕当前会话内容持续生成回复、总结、评估和跟进。';
  project.tags = ['assistant-smoke', 'ai-dialogue'];
  project.language = settings.locale;
  project.createdAt = now;
  project.updatedAt = now;
  project.entries = [];
  project.nodes = [];
  project.relations = [];
  project.insights.items = [];
  project.summary = {
    ...project.summary,
    overview: '等待首轮单用户 AI 回复。',
    participantOverview: [],
    coreTopics: [],
    majorClaims: [],
    keyEvidence: [],
    majorRebuttals: [],
    unresolvedQuestions: [],
    disputes: [],
    currentConclusion: '尚无结论。',
    nextSteps: [],
    suggestions: [],
    followupQuestions: [],
  };
  project.room.id = `room_assistant_smoke_${stamp}`;
  project.room.slug = `assistant-smoke-${stamp}`;
  project.room.visibility = 'private';
  project.room.session.id = `session_assistant_smoke_${stamp}`;
  project.room.session.title = 'Assistant smoke session';
  project.room.session.goal = project.goal;
  project.room.session.startedAt = now;
  project.room.session.sync.lastEventAt = now;
  project.room.notes = ['Assistant workspace smoke validation.'];
  project.participants = project.participants.slice(0, 1).map((participant) => ({
    ...participant,
    id: `participant_assistant_smoke_${stamp}`,
    name: settings.profile.displayName,
    profileOwnerId: settings.profile.localIdentityId,
    avatarLabel: settings.profile.displayName.slice(0, 2),
    avatarPreset: settings.profile.avatarPreset,
    avatarImageDataUrl: settings.profile.avatarImageDataUrl,
    collaborationRole: 'host',
    role: 'moderator',
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
    connectionId: `presence_assistant_smoke_${stamp}`,
    lastSeenAt: now,
    active: true,
  }];
  project.room.aiConfig = {
    providerId: 'mock',
    model: settings.provider.providers.mock.model,
    ownerIdentityId: settings.profile.localIdentityId,
    ownerParticipantId: project.participants[0].id,
    updatedAt: now,
    updatedByParticipantId: project.participants[0].id,
  };
  project.providerSnapshot = {
    providerId: 'mock',
    model: settings.provider.providers.mock.model,
    generatedAt: now,
    version: 'seed',
  };
  return project;
}

let exitCode = 0;
let projectId = '';
let staleEmptyProjectId = '';
let sessionTitle = '';

await startServer({ dir: process.cwd(), port, isDev: false, hostname: '127.0.0.1', allowRetry: false });

const jar = new CookieJar({ [identityCookie]: 'profile_assistant_smoke' });

try {
  const settingsGet = await requestJson(jar, '/api/settings');
  assert.equal(settingsGet.response.status, 200);

  const settingsSave = await requestJson(jar, '/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...settingsGet.json.settings,
      locale: 'zh-CN',
      profile: {
        ...settingsGet.json.settings.profile,
        displayName: 'Assistant Smoke User',
      },
      provider: {
        ...settingsGet.json.settings.provider,
        activeProviderId: 'mock',
        activeMode: 'mock',
      },
    }),
  });
  assert.equal(settingsSave.response.status, 200);

  const template = JSON.parse(await readFile('data/projects/project_bd907307339f.json', 'utf8'));

  const staleTimestamp = new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString();
  const stalePayload = buildSoloProject(template, settingsSave.json.settings);
  stalePayload.title = '空白历史草稿';
  stalePayload.summary = {
    overview: '尚无 AI 总结。',
    participantOverview: [],
    coreTopics: [],
    majorClaims: [],
    keyEvidence: [],
    majorRebuttals: [],
    unresolvedQuestions: [],
    disputes: [],
    currentConclusion: '尚未形成当前结论。',
    nextSteps: [],
    suggestions: [],
    followupQuestions: [],
    evaluation: {
      leaning: '待评估',
      favoredByEvidence: '待分析',
      favoredByResponsiveness: '待分析',
      favoredByLogic: '待分析',
      moreUnanswered: '待分析',
      confidence: '低',
      reasons: [],
      improvementSuggestions: [],
    },
  };
  stalePayload.createdAt = staleTimestamp;
  stalePayload.updatedAt = staleTimestamp;
  stalePayload.room.session.startedAt = staleTimestamp;
  stalePayload.room.session.sync.lastEventAt = staleTimestamp;
  stalePayload.room.aiConfig.updatedAt = staleTimestamp;
  stalePayload.providerSnapshot.generatedAt = staleTimestamp;
  stalePayload.participants[0].presence.lastSeenAt = staleTimestamp;
  stalePayload.room.presence[0].lastSeenAt = staleTimestamp;
  staleEmptyProjectId = stalePayload.id;
  await writeFile(path.join(dataRoot, 'projects', `${staleEmptyProjectId}.json`), `${JSON.stringify(stalePayload, null, 2)}\n`, 'utf8');

  const assistantAfterStaleDraft = await request(jar, '/zh-CN/assistant');
  assert.equal(assistantAfterStaleDraft.status, 200);
  assert.equal(await fileExists(path.join(dataRoot, 'projects', `${staleEmptyProjectId}.json`)), false);

  const payload = buildSoloProject(template, settingsSave.json.settings);
  const createProject = await requestJson(jar, '/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(createProject.response.status, 201);

  const project = createProject.json.project;
  projectId = project.id;
  const participantId = project.participants[0].id;

  const uploadForm = new FormData();
  uploadForm.set('participantId', participantId);
  uploadForm.set('note', 'assistant smoke note');
  uploadForm.set('file', new File(['Assistant workspace evidence context.'], 'assistant-note.txt', { type: 'text/plain' }));
  const upload = await requestJson(jar, `/api/projects/${project.id}/attachments?locale=zh-CN`, { method: 'POST', body: uploadForm });
  assert.equal(upload.response.status, 201);
  const uploadedAttachmentId = upload.json.attachment.id;

  const imageForm = new FormData();
  imageForm.set('participantId', participantId);
  imageForm.set('note', 'assistant smoke image');
  imageForm.set('file', new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0i8AAAAASUVORK5CYII=', 'base64')], 'assistant-pixel.png', { type: 'image/png' }));
  const imageUpload = await requestJson(jar, `/api/projects/${project.id}/attachments?locale=zh-CN`, { method: 'POST', body: imageForm });
  assert.equal(imageUpload.response.status, 201);
  const imageAttachmentId = imageUpload.json.attachment.id;

  const assistantReply = await requestJson(jar, `/api/projects/${project.id}/assistant`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      locale: 'zh-CN',
      message: '请根据当前对话、附件证据和讨论目标，为我生成第一轮个人 AI 工作台回复。',
      attachmentIds: [uploadedAttachmentId],
    }),
  });
  assert.equal(assistantReply.response.status, 200);
  assert.equal(assistantReply.json.providerId, 'mock');
  assert.ok(assistantReply.json.conversation.reply.length > 0);
  assert.match(assistantReply.json.conversation.reply, /Assistant workspace evidence context|附件内容摘录|添付内容|Extrait de la piece jointe/);
  assert.ok(assistantReply.json.collaboration.events.some((event) => event.actorType === 'ai'));
  assert.ok(assistantReply.json.collaboration.events.some((event) => event.actorType === 'participant' && event.attachmentIds?.includes(uploadedAttachmentId)));
  sessionTitle = assistantReply.json.project.title;
  assert.notEqual(sessionTitle, '个人 AI 工作台');
  assert.ok(sessionTitle.includes('请根据当前对话') || sessionTitle.length > 4);

  const imageReply = await requestJson(jar, `/api/projects/${project.id}/assistant`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      locale: 'zh-CN',
      message: '请结合这张图片附件给出一条简短回复，并保留它是参考附件的事实。',
      attachmentIds: [imageAttachmentId],
    }),
  });
  assert.equal(imageReply.response.status, 200);
  assert.ok(imageReply.json.collaboration.events.some((event) => event.actorType === 'participant' && event.attachmentIds?.includes(imageAttachmentId)));
  assert.ok(imageReply.json.conversation.reply.length > 0);

  const summary = await requestJson(jar, `/api/projects/${project.id}/ai`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ task: 'summarizeDiscussion', locale: 'zh-CN' }),
  });
  assert.equal(summary.response.status, 200);
  assert.ok(summary.json.analysis.summary.overview.length > 0);
  assert.ok(summary.json.project.summary.overview.length > 0);

  const evaluation = await requestJson(jar, `/api/projects/${project.id}/ai`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ task: 'evaluateDiscussion', locale: 'zh-CN' }),
  });
  assert.equal(evaluation.response.status, 200);
  assert.ok(evaluation.json.analysis.summary.evaluation.reasons.length >= 0);

  const followup = await requestJson(jar, `/api/projects/${project.id}/ai`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ task: 'generateFollowupQuestions', locale: 'zh-CN' }),
  });
  assert.equal(followup.response.status, 200);
  assert.ok(Array.isArray(followup.json.analysis.summary.followupQuestions));

  const workspace = await request(jar, `/zh-CN/projects/${project.id}`);
  const workspaceHtml = await workspace.text();
  assert.equal(workspace.status, 200);
  assert.match(workspaceHtml, /运行总结|运行评估|生成跟进/);

  const archive = await requestJson(jar, `/api/projects/${project.id}/assistant/session`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'archive', locale: 'zh-CN' }),
  });
  assert.equal(archive.response.status, 200);
  assert.equal(archive.json.project.metadata.pendingDeletionAt, undefined);
  assert.ok(archive.json.project.metadata.archivedAt);

  const assistantArchivedPage = await request(jar, `/zh-CN/assistant?chat=${project.id}`);
  const assistantArchivedHtml = await assistantArchivedPage.text();
  assert.equal(assistantArchivedPage.status, 200);
  assert.match(assistantArchivedHtml, /已归档会话|Archived sessions|Archiv/);
  assert.match(assistantArchivedHtml, /当前会话已归档|This session is archived|アーカイブ済み|archivee/i);

  const uploadWhileArchivedForm = new FormData();
  uploadWhileArchivedForm.set('participantId', participantId);
  uploadWhileArchivedForm.set('file', new File(['archived content'], 'archived.txt', { type: 'text/plain' }));
  const uploadWhileArchived = await requestJson(jar, `/api/projects/${project.id}/attachments?locale=zh-CN`, { method: 'POST', body: uploadWhileArchivedForm });
  assert.equal(uploadWhileArchived.response.status, 409);

  const sendWhileArchived = await requestJson(jar, `/api/projects/${project.id}/assistant`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ locale: 'zh-CN', message: '归档后继续发言应该被拦截。' }),
  });
  assert.equal(sendWhileArchived.response.status, 409);

  const restore = await requestJson(jar, `/api/projects/${project.id}/assistant/session`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'restore', locale: 'zh-CN' }),
  });
  assert.equal(restore.response.status, 200);
  assert.equal(restore.json.project.metadata.archivedAt, undefined);

  const deleteSession = await requestJson(jar, `/api/projects/${project.id}/assistant/session`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'delete', locale: 'zh-CN' }),
  });
  assert.equal(deleteSession.response.status, 200);
  assert.ok(deleteSession.json.project.metadata.pendingDeletionAt);

  const assistantAfterDelete = await request(jar, `/zh-CN/assistant?chat=${project.id}`);
  const assistantAfterDeleteHtml = await assistantAfterDelete.text();
  assert.equal(assistantAfterDelete.status, 200);
  assert.ok(assistantAfterDeleteHtml.includes(sessionTitle));
  assert.match(assistantAfterDeleteHtml, /待清理会话|Pending cleanup|suppression|削除待ち/);
  assert.match(assistantAfterDeleteHtml, /30\s*天|30\s*days|30\s*日|30\s*jours/);

  const uploadWhilePendingForm = new FormData();
  uploadWhilePendingForm.set('participantId', participantId);
  uploadWhilePendingForm.set('file', new File(['pending content'], 'pending.txt', { type: 'text/plain' }));
  const uploadWhilePending = await requestJson(jar, `/api/projects/${project.id}/attachments?locale=zh-CN`, { method: 'POST', body: uploadWhilePendingForm });
  assert.equal(uploadWhilePending.response.status, 409);

  const sendWhilePendingCleanup = await requestJson(jar, `/api/projects/${project.id}/assistant`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ locale: 'zh-CN', message: '待清理状态不应继续聊天。' }),
  });
  assert.equal(sendWhilePendingCleanup.response.status, 409);

  const restoreFromPendingCleanup = await requestJson(jar, `/api/projects/${project.id}/assistant/session`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'restore', locale: 'zh-CN' }),
  });
  assert.equal(restoreFromPendingCleanup.response.status, 200);
  assert.equal(restoreFromPendingCleanup.json.project.metadata.pendingDeletionAt, undefined);

  const replyAfterRestore = await requestJson(jar, `/api/projects/${project.id}/assistant`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ locale: 'zh-CN', message: '恢复后请继续回复，证明会话已重新激活。' }),
  });
  assert.equal(replyAfterRestore.response.status, 200);
  assert.ok(replyAfterRestore.json.conversation.reply.length > 0);

  console.log('[assistant-smoke] send/reply, text-document context, staged image attachment, title generation, summary/evaluation/followup, archive/read-only, delete pending-cleanup, restore all passed');
} catch (error) {
  exitCode = 1;
  console.error('[assistant-smoke] failed');
  console.error(error);
} finally {
  if (projectId) {
    await cleanupProjectArtifacts(projectId);
  }
  if (staleEmptyProjectId) {
    await cleanupProjectArtifacts(staleEmptyProjectId);
  }
  process.exit(exitCode);
}







