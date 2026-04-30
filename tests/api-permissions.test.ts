import { mkdir, mkdtemp, rm } from "node:fs/promises";
import Module from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

type ModuleLoader = typeof Module & {
  _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
};

async function withTempWorkspace<T>(run: (setIdentity: (identityId: string | null) => void) => Promise<T>) {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dialectica-api-permissions-"));
  const moduleLoader = Module as ModuleLoader;
  const originalLoad = moduleLoader._load;
  let activeIdentityId: string | null = null;

  moduleLoader._load = function patchedLoad(request, parent, isMain) {
    if (request === "next/headers") {
      return {
        cookies: async () => ({
          get: (name: string) => (
            name === "dialectica-profile-id" && activeIdentityId
              ? { name, value: activeIdentityId }
              : undefined
          ),
        }),
        headers: async () => new Headers({ "accept-language": "en-US,en;q=0.9" }),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    process.chdir(tempDir);
    await mkdir(path.join(tempDir, "data", "projects"), { recursive: true });
    await mkdir(path.join(tempDir, "data", "knowledge"), { recursive: true });
    await mkdir(path.join(tempDir, "data", "collaboration"), { recursive: true });
    return await run((identityId) => { activeIdentityId = identityId; });
  } finally {
    moduleLoader._load = originalLoad;
    for (const cacheKey of Object.keys(require.cache)) {
      if (cacheKey.includes(`${path.sep}.test-dist${path.sep}src${path.sep}`)) {
        delete require.cache[cacheKey];
      }
    }
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
}

function jsonRequest(url: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown) {
  return new Request(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("API mutation permission boundaries", () => {
  it("allows an owner to update and delete their own knowledge node", async () => {
    await withTempWorkspace(async (setIdentity) => {
      const repository = await import("@/lib/data/repository");
      const service = await import("@/lib/knowledge/service");
      const { createDefaultSettings } = await import("@/lib/factories");
      const knowledgeNodeRoute = await import("@/app/api/knowledge/[nodeId]/route");

      const settings = createDefaultSettings("en");
      setIdentity(settings.profile.localIdentityId);
      await repository.saveSettings(settings);
      const project = repository.createProjectSkeleton("en", "discussion", settings);
      project.title = "Owner knowledge node";
      project.goal = "Verify owner-level node mutation permissions.";

      const savedProject = await repository.createProject(project, "en", {
        skipAutoAnalyze: true,
        settingsOverride: settings,
      });
      const snapshot = await service.extractAndSaveProjectKnowledge(savedProject.id, "en", {
        generateGraphLinks: true,
      });
      const nodeId = snapshot?.nodes.find((node) => node.type === "project")?.id;
      expect(Boolean(nodeId)).toBe(true);

      const updateResponse = await knowledgeNodeRoute.PUT(
        jsonRequest(`http://test.local/api/knowledge/${encodeURIComponent(nodeId!)}?locale=en`, "PUT", { title: "Updated owner node" }),
        { params: Promise.resolve({ nodeId: nodeId! }) },
      );
      expect(updateResponse).toBeDefined();
      expect(updateResponse!.status).toBe(200);
      expect((await service.getKnowledgeNodeDetail(nodeId!, "en"))?.node.title).toBe("Updated owner node");

      const deleteResponse = await knowledgeNodeRoute.DELETE(
        jsonRequest(`http://test.local/api/knowledge/${encodeURIComponent(nodeId!)}?locale=en`, "DELETE"),
        { params: Promise.resolve({ nodeId: nodeId! }) },
      );
      expect(deleteResponse).toBeDefined();
      expect(deleteResponse!.status).toBe(200);
      expect(await service.getKnowledgeNodeDetail(nodeId!, "en")).toBe(null);
    });
  });

  it("rejects knowledge node mutation for non-owners and protected samples", async () => {
    await withTempWorkspace(async (setIdentity) => {
      const repository = await import("@/lib/data/repository");
      const service = await import("@/lib/knowledge/service");
      const { createDefaultSettings } = await import("@/lib/factories");
      const knowledgeNodeRoute = await import("@/app/api/knowledge/[nodeId]/route");

      const ownerSettings = createDefaultSettings("en");
      setIdentity(ownerSettings.profile.localIdentityId);
      await repository.saveSettings(ownerSettings);
      const project = repository.createProjectSkeleton("en", "discussion", ownerSettings);
      project.title = "Non-owner knowledge node";
      project.goal = "Verify non-owner node mutation permissions.";

      const savedProject = await repository.createProject(project, "en", {
        skipAutoAnalyze: true,
        settingsOverride: ownerSettings,
      });
      const snapshot = await service.extractAndSaveProjectKnowledge(savedProject.id, "en", {
        generateGraphLinks: true,
      });
      const nodeId = snapshot?.nodes.find((node) => node.type === "project")?.id;
      expect(Boolean(nodeId)).toBe(true);

      const viewerSettings = createDefaultSettings("en");
      viewerSettings.profile.localIdentityId = "profile_viewer_permission_test";
      viewerSettings.profile.displayName = "Viewer";
      setIdentity(viewerSettings.profile.localIdentityId);

      const viewerUpdate = await knowledgeNodeRoute.PUT(
        jsonRequest(`http://test.local/api/knowledge/${encodeURIComponent(nodeId!)}?locale=en`, "PUT", { title: "Viewer overwrite" }),
        { params: Promise.resolve({ nodeId: nodeId! }) },
      );
      expect(viewerUpdate).toBeDefined();
      expect(viewerUpdate!.status).toBe(403);

      const viewerDelete = await knowledgeNodeRoute.DELETE(
        jsonRequest(`http://test.local/api/knowledge/${encodeURIComponent(nodeId!)}?locale=en`, "DELETE"),
        { params: Promise.resolve({ nodeId: nodeId! }) },
      );
      expect(viewerDelete).toBeDefined();
      expect(viewerDelete!.status).toBe(403);
      expect((await service.getKnowledgeNodeDetail(nodeId!, "en"))?.node.title).not.toBe("Viewer overwrite");

      const sampleGraph = await service.buildKnowledgeGraph({ locale: "zh-CN", projectId: "sample_civic_ai_room" });
      const sampleNodeId = sampleGraph.nodes[0]?.id;
      expect(Boolean(sampleNodeId)).toBe(true);
      const sampleUpdate = await knowledgeNodeRoute.PUT(
        jsonRequest(`http://test.local/api/knowledge/${encodeURIComponent(sampleNodeId!)}?locale=zh-CN`, "PUT", { title: "Sample overwrite" }),
        { params: Promise.resolve({ nodeId: sampleNodeId! }) },
      );
      expect(sampleUpdate).toBeDefined();
      expect(sampleUpdate!.status).toBe(403);

      const sampleDelete = await knowledgeNodeRoute.DELETE(
        jsonRequest(`http://test.local/api/knowledge/${encodeURIComponent(sampleNodeId!)}?locale=zh-CN`, "DELETE"),
        { params: Promise.resolve({ nodeId: sampleNodeId! }) },
      );
      expect(sampleDelete).toBeDefined();
      expect(sampleDelete!.status).toBe(403);
    });
  });

  it("filters knowledge reads by source project access while keeping bundled samples visible", async () => {
    await withTempWorkspace(async (setIdentity) => {
      const repository = await import("@/lib/data/repository");
      const service = await import("@/lib/knowledge/service");
      const { createDefaultSettings } = await import("@/lib/factories");

      const ownerSettings = createDefaultSettings("en");
      setIdentity(ownerSettings.profile.localIdentityId);
      await repository.saveSettings(ownerSettings);
      const project = repository.createProjectSkeleton("en", "discussion", ownerSettings);
      project.title = "Private knowledge visibility";
      project.goal = "Ensure knowledge snapshots are filtered by source project access.";

      const savedProject = await repository.createProject(project, "en", {
        skipAutoAnalyze: true,
        settingsOverride: ownerSettings,
      });
      await service.extractAndSaveProjectKnowledge(savedProject.id, "en", {
        generateGraphLinks: true,
      });

      const ownerNodes = await service.listKnowledgeNodes({ locale: "en" });
      expect(ownerNodes.some((node) => node.sourceProjectId === savedProject.id)).toBe(true);
      const ownerGraph = await service.buildKnowledgeGraph({ locale: "en", projectId: savedProject.id });
      expect(ownerGraph.nodes.some((node) => node.sourceProjectId === savedProject.id)).toBe(true);

      const viewerSettings = createDefaultSettings("en");
      viewerSettings.profile.localIdentityId = "profile_knowledge_read_viewer";
      viewerSettings.profile.displayName = "Read Viewer";
      setIdentity(viewerSettings.profile.localIdentityId);
      await repository.saveSettings(viewerSettings);

      const viewerNodes = await service.listKnowledgeNodes({ locale: "en" });
      expect(viewerNodes.some((node) => node.sourceProjectId === savedProject.id)).toBe(false);
      const viewerGraph = await service.buildKnowledgeGraph({ locale: "en", projectId: savedProject.id });
      expect(viewerGraph.nodes.some((node) => node.sourceProjectId === savedProject.id)).toBe(false);

      const sampleGraph = await service.buildKnowledgeGraph({ locale: "zh-CN", projectId: "sample_civic_ai_room" });
      expect(sampleGraph.nodes.length).toBeGreaterThan(0);
      expect(sampleGraph.nodes.every((node) => node.sourceProjectId === "sample_civic_ai_room")).toBe(true);
    });
  });

  it("requires source project permissions before creating user graphs", async () => {
    await withTempWorkspace(async (setIdentity) => {
      const repository = await import("@/lib/data/repository");
      const collaborationStore = await import("@/lib/collaboration/store");
      const { createDefaultSettings } = await import("@/lib/factories");
      const userGraphsRoute = await import("@/app/api/knowledge/user-graphs/route");

      const ownerSettings = createDefaultSettings("en");
      setIdentity(ownerSettings.profile.localIdentityId);
      await repository.saveSettings(ownerSettings);
      const project = repository.createProjectSkeleton("en", "discussion", ownerSettings);
      project.title = "Graph source permissions";
      project.goal = "Verify user graph source project permissions.";
      project.room.visibility = "public";
      project.room.joinMode = "open";

      const savedProject = await repository.createProject(project, "en", {
        skipAutoAnalyze: true,
        settingsOverride: ownerSettings,
      });
      await collaborationStore.appendCollaborationMessage(savedProject, {
        type: "message",
        participantId: savedProject.participants[0]?.id,
        message: "The project owner can request graph generation from this discussion.",
      });

      const ownerCreate = await userGraphsRoute.POST(
        jsonRequest("http://test.local/api/knowledge/user-graphs", "POST", {
          title: "Allowed graph",
          sourceProjectIds: [savedProject.id],
          locale: "en",
          visibility: "private",
        }),
      );
      expect(ownerCreate.status).toBe(201);
      await new Promise((resolve) => setTimeout(resolve, 20));

      const viewerSettings = createDefaultSettings("en");
      viewerSettings.profile.localIdentityId = "profile_graph_source_viewer";
      viewerSettings.profile.displayName = "Graph Viewer";
      setIdentity(viewerSettings.profile.localIdentityId);
      await repository.saveSettings(viewerSettings);

      const viewerCreate = await userGraphsRoute.POST(
        jsonRequest("http://test.local/api/knowledge/user-graphs", "POST", {
          title: "Forbidden graph",
          sourceProjectIds: [savedProject.id],
          locale: "en",
          visibility: "private",
        }),
      );
      expect(viewerCreate.status).toBe(403);

      const viewerProject = repository.createProjectSkeleton("en", "discussion", viewerSettings);
      viewerProject.title = "Viewer owned source";
      const viewerSavedProject = await repository.createProject(viewerProject, "en", {
        skipAutoAnalyze: true,
        settingsOverride: viewerSettings,
      });
      const mixedCreate = await userGraphsRoute.POST(
        jsonRequest("http://test.local/api/knowledge/user-graphs", "POST", {
          title: "Mixed forbidden graph",
          sourceProjectIds: [viewerSavedProject.id, savedProject.id],
          locale: "en",
          visibility: "private",
        }),
      );
      expect(mixedCreate.status).toBe(403);

      const sampleCreate = await userGraphsRoute.POST(
        jsonRequest("http://test.local/api/knowledge/user-graphs", "POST", {
          title: "Sample forbidden graph",
          sourceProjectIds: ["sample_civic_ai_room"],
          locale: "zh-CN",
          visibility: "private",
        }),
      );
      expect(sampleCreate.status).toBe(409);
    });
  });

  it("allows member reactions but rejects public viewers and protected samples", async () => {
    await withTempWorkspace(async (setIdentity) => {
      const repository = await import("@/lib/data/repository");
      const collaborationStore = await import("@/lib/collaboration/store");
      const { createDefaultSettings } = await import("@/lib/factories");
      const eventsRoute = await import("@/app/api/projects/[projectId]/events/route");

      const ownerSettings = createDefaultSettings("en");
      setIdentity(ownerSettings.profile.localIdentityId);
      await repository.saveSettings(ownerSettings);
      const project = repository.createProjectSkeleton("en", "discussion", ownerSettings);
      project.title = "Reaction permissions";
      project.goal = "Verify reaction write permissions.";
      project.room.visibility = "public";
      project.room.joinMode = "open";

      const savedProject = await repository.createProject(project, "en", {
        skipAutoAnalyze: true,
        settingsOverride: ownerSettings,
      });
      const collaboration = await collaborationStore.appendCollaborationMessage(savedProject, {
        type: "message",
        participantId: savedProject.participants[0]?.id,
        message: "Message with reaction boundary.",
      });
      const eventId = collaboration.events.at(-1)?.id;
      expect(Boolean(eventId)).toBe(true);

      const memberReaction = await eventsRoute.PATCH(
        jsonRequest(`http://test.local/api/projects/${savedProject.id}/events?locale=en`, "PATCH", { eventId, emoji: "👍" }),
        { params: Promise.resolve({ projectId: savedProject.id }) },
      );
      expect(memberReaction.status).toBe(200);

      const viewerSettings = createDefaultSettings("en");
      viewerSettings.profile.localIdentityId = "profile_public_viewer_permission_test";
      viewerSettings.profile.displayName = "Public Viewer";
      setIdentity(viewerSettings.profile.localIdentityId);

      const viewerReaction = await eventsRoute.PATCH(
        jsonRequest(`http://test.local/api/projects/${savedProject.id}/events?locale=en`, "PATCH", { eventId, emoji: "👍" }),
        { params: Promise.resolve({ projectId: savedProject.id }) },
      );
      expect([403, 409]).toContain(viewerReaction.status);

      const sampleReaction = await eventsRoute.PATCH(
        jsonRequest("http://test.local/api/projects/sample_civic_ai_room/events?locale=zh-CN", "PATCH", { eventId: "sample-event", emoji: "👍" }),
        { params: Promise.resolve({ projectId: "sample_civic_ai_room" }) },
      );
      expect(sampleReaction.status).toBe(403);
    });
  });

  it("keeps room ownership changes explicit and persists role updates", async () => {
    await withTempWorkspace(async (setIdentity) => {
      const repository = await import("@/lib/data/repository");
      const { createDefaultSettings, createParticipantPresence } = await import("@/lib/factories");
      const roomManageRoute = await import("@/app/api/projects/[projectId]/room/manage/route");

      const ownerSettings = createDefaultSettings("en");
      setIdentity(ownerSettings.profile.localIdentityId);
      await repository.saveSettings(ownerSettings);

      const project = repository.createProjectSkeleton("en", "discussion", ownerSettings);
      project.title = "Persistent role assignment";
      project.goal = "Verify role mutations persist and ownership cannot be demoted implicitly.";
      const savedProject = await repository.createProject(project, "en", {
        skipAutoAnalyze: true,
        settingsOverride: ownerSettings,
      });
      const host = savedProject.participants[0]!;
      const member = {
        ...host,
        id: "participant_member_role_persistence",
        name: "Persistent Member",
        role: "speaker" as const,
        collaborationRole: "participant" as const,
        customRoleLabel: undefined,
        profileOwnerId: "profile_member_role_persistence",
        seatLabel: "Seat-2",
        presence: createParticipantPresence(savedProject.room.session.id, "online"),
      };
      const participants = [host, member];
      const projectWithMember = await repository.upsertProject({
        ...savedProject,
        participants,
        room: repository.syncRoomFromParticipants(savedProject, participants),
      });

      const missingRole = await roomManageRoute.POST(
        jsonRequest(`http://test.local/api/projects/${projectWithMember.id}/room/manage?locale=en`, "POST", {
          action: "setRole",
          participantId: "participant_missing",
          role: "observer",
        }),
        { params: Promise.resolve({ projectId: projectWithMember.id }) },
      );
      expect(missingRole.status).toBe(404);

      const demoteHost = await roomManageRoute.POST(
        jsonRequest(`http://test.local/api/projects/${projectWithMember.id}/room/manage?locale=en`, "POST", {
          action: "setRole",
          participantId: host.id,
          role: "observer",
        }),
        { params: Promise.resolve({ projectId: projectWithMember.id }) },
      );
      expect(demoteHost.status).toBe(400);
      expect((await repository.getProject(projectWithMember.id, "en")).participants.find((participant) => participant.id === host.id)?.collaborationRole).toBe("host");

      const promoteMember = await roomManageRoute.POST(
        jsonRequest(`http://test.local/api/projects/${projectWithMember.id}/room/manage?locale=en`, "POST", {
          action: "setRole",
          participantId: member.id,
          role: "facilitator",
        }),
        { params: Promise.resolve({ projectId: projectWithMember.id }) },
      );
      expect(promoteMember.status).toBe(200);
      const persistedProject = await repository.getProject(projectWithMember.id, "en");
      expect(persistedProject.participants.find((participant) => participant.id === member.id)?.collaborationRole).toBe("facilitator");
      expect(persistedProject.room.presence.find((presence) => presence.participantId === member.id)?.collaborationRole).toBe("facilitator");
    });
  });

  it("prevents invite-based ownership escalation while allowing normal invite roles", async () => {
    await withTempWorkspace(async (setIdentity) => {
      const repository = await import("@/lib/data/repository");
      const collaborationStore = await import("@/lib/collaboration/store");
      const { createDefaultSettings, createParticipantPresence } = await import("@/lib/factories");
      const invitesRoute = await import("@/app/api/projects/[projectId]/invites/route");
      const acceptRoute = await import("@/app/api/projects/[projectId]/invites/accept/route");

      const ownerSettings = createDefaultSettings("en");
      setIdentity(ownerSettings.profile.localIdentityId);
      await repository.saveSettings(ownerSettings);

      const project = repository.createProjectSkeleton("en", "discussion", ownerSettings);
      project.title = "Invite role boundaries";
      project.goal = "Verify invites cannot bypass explicit ownership and role assignment flows.";
      project.room.visibility = "public";
      project.room.joinMode = "open";
      const savedProject = await repository.createProject(project, "en", {
        skipAutoAnalyze: true,
        settingsOverride: ownerSettings,
      });
      const host = savedProject.participants[0]!;
      const facilitator = {
        ...host,
        id: "participant_invite_facilitator",
        name: "Invite Facilitator",
        role: "custom" as const,
        collaborationRole: "facilitator" as const,
        customRoleLabel: "Facilitator",
        profileOwnerId: "profile_invite_facilitator",
        seatLabel: "FAC",
        presence: createParticipantPresence(savedProject.room.session.id, "online"),
      };
      const participants = [host, facilitator];
      const projectWithFacilitator = await repository.upsertProject({
        ...savedProject,
        participants,
        room: repository.syncRoomFromParticipants(savedProject, participants),
      });

      const ownerHostInvite = await invitesRoute.POST(
        jsonRequest(`http://test.local/api/projects/${projectWithFacilitator.id}/invites?locale=en`, "POST", {
          role: "host",
          expiresInHours: 24,
        }),
        { params: Promise.resolve({ projectId: projectWithFacilitator.id }) },
      );
      expect(ownerHostInvite.status).toBe(400);

      const ownerFacilitatorInvite = await invitesRoute.POST(
        jsonRequest(`http://test.local/api/projects/${projectWithFacilitator.id}/invites?locale=en`, "POST", {
          role: "facilitator",
          expiresInHours: 24,
        }),
        { params: Promise.resolve({ projectId: projectWithFacilitator.id }) },
      );
      expect(ownerFacilitatorInvite.status).toBe(201);

      const facilitatorSettings = createDefaultSettings("en");
      facilitatorSettings.profile.localIdentityId = facilitator.profileOwnerId!;
      facilitatorSettings.profile.displayName = facilitator.name;
      setIdentity(facilitatorSettings.profile.localIdentityId);
      await repository.saveSettings(facilitatorSettings);

      const facilitatorFacilitatorInvite = await invitesRoute.POST(
        jsonRequest(`http://test.local/api/projects/${projectWithFacilitator.id}/invites?locale=en`, "POST", {
          role: "facilitator",
          expiresInHours: 24,
        }),
        { params: Promise.resolve({ projectId: projectWithFacilitator.id }) },
      );
      expect(facilitatorFacilitatorInvite.status).toBe(403);

      const facilitatorParticipantInvite = await invitesRoute.POST(
        jsonRequest(`http://test.local/api/projects/${projectWithFacilitator.id}/invites?locale=en`, "POST", {
          role: "participant",
          expiresInHours: 24,
        }),
        { params: Promise.resolve({ projectId: projectWithFacilitator.id }) },
      );
      expect(facilitatorParticipantInvite.status).toBe(201);

      await collaborationStore.createInvite(projectWithFacilitator, {
        role: "host",
        createdByParticipantId: host.id,
        expiresInHours: 24,
      });
      const legacyHostInvite = (await collaborationStore.getCollaborationState(projectWithFacilitator)).invites.find((invite) => invite.role === "host");
      expect(Boolean(legacyHostInvite)).toBe(true);
      const acceptLegacyHost = await acceptRoute.POST(
        jsonRequest(`http://test.local/api/projects/${projectWithFacilitator.id}/invites/accept?locale=en`, "POST", {
          token: legacyHostInvite!.token,
          name: "Legacy Host Invitee",
          profileOwnerId: "profile_legacy_host_invitee",
        }),
        { params: Promise.resolve({ projectId: projectWithFacilitator.id }) },
      );
      expect(acceptLegacyHost.status).toBe(409);
    });
  });

  it("rejects metadata-only local attachments so the API cannot save broken file references", async () => {
    await withTempWorkspace(async (setIdentity) => {
      const repository = await import("@/lib/data/repository");
      const collaborationStore = await import("@/lib/collaboration/store");
      const { createDefaultSettings } = await import("@/lib/factories");
      const attachmentsRoute = await import("@/app/api/projects/[projectId]/attachments/route");

      const settings = createDefaultSettings("en");
      setIdentity(settings.profile.localIdentityId);
      await repository.saveSettings(settings);

      const project = repository.createProjectSkeleton("en", "discussion", settings);
      project.title = "Metadata attachment guard";
      project.goal = "Verify metadata attachments cannot create fake local files.";
      const savedProject = await repository.createProject(project, "en", {
        skipAutoAnalyze: true,
        settingsOverride: settings,
      });
      const participant = savedProject.participants[0]!;

      const brokenLocal = await attachmentsRoute.POST(
        jsonRequest(`http://test.local/api/projects/${savedProject.id}/attachments?locale=en`, "POST", {
          name: "ghost.txt",
          kind: "document",
          mimeType: "text/plain",
          sizeBytes: 12,
          uploadedByParticipantId: participant.id,
        }),
        { params: Promise.resolve({ projectId: savedProject.id }) },
      );

      expect(brokenLocal.status).toBe(400);
      const collaboration = await collaborationStore.getCollaborationState(savedProject);
      expect(collaboration.attachments).toHaveLength(0);
    });
  });

  it("does not report success for room nickname saves because nicknames persist through settings", async () => {
    await withTempWorkspace(async (setIdentity) => {
      const repository = await import("@/lib/data/repository");
      const { createDefaultSettings } = await import("@/lib/factories");
      const roomManageRoute = await import("@/app/api/projects/[projectId]/room/manage/route");

      const settings = createDefaultSettings("en");
      setIdentity(settings.profile.localIdentityId);
      await repository.saveSettings(settings);

      const project = repository.createProjectSkeleton("en", "discussion", settings);
      project.title = "Nickname API guard";
      project.goal = "Verify room manage does not fake-save local nicknames.";
      const savedProject = await repository.createProject(project, "en", {
        skipAutoAnalyze: true,
        settingsOverride: settings,
      });
      const participant = savedProject.participants[0]!;

      const nicknameResponse = await roomManageRoute.POST(
        jsonRequest(`http://test.local/api/projects/${savedProject.id}/room/manage?locale=en`, "POST", {
          action: "setNickname",
          participantId: participant.id,
          nickname: "Local alias",
        }),
        { params: Promise.resolve({ projectId: savedProject.id }) },
      );

      expect(nicknameResponse.status).toBe(400);
      expect((await repository.getSettings()).participantNicknames?.[`${savedProject.id}:${participant.id}`]).toBe(undefined);
    });
  });
});
