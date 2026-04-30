import { bundledSampleProjectIds } from "@/data/samples";
import { AppSettings, CollaborationRole, DiscussionProject, Participant } from "@/lib/types";

export function isProtectedSampleProject(project: Pick<DiscussionProject, "id" | "metadata">) {
  return project.metadata.isSample && bundledSampleProjectIds.has(project.id);
}

function isModeratorParticipant(participant: Participant) {
  return participant.collaborationRole === "host"
    || participant.collaborationRole === "facilitator"
    || participant.role === "moderator";
}

function isOwner(participant: Participant) {
  return participant.collaborationRole === "host";
}

function isAdmin(participant: Participant) {
  return participant.collaborationRole === "facilitator";
}

export function isProjectWorkspaceArchived(project: DiscussionProject) {
  return Boolean(project.room.archivedAt || project.metadata.archivedAt);
}

export function getProjectCreatorIdentityId(project: DiscussionProject) {
  return project.metadata.createdByIdentityId
    ?? project.participants.find((participant) => participant.collaborationRole === "host")?.profileOwnerId
    ?? project.room.aiConfig.ownerIdentityId;
}

export function isProjectCreator(project: DiscussionProject, localIdentityId: string) {
  return Boolean(localIdentityId) && getProjectCreatorIdentityId(project) === localIdentityId;
}

export function canArchivePrivateWorkspace(project: DiscussionProject) {
  return !isProtectedSampleProject(project)
    && project.scenario !== "ai-dialogue"
    && project.room.visibility === "private"
    && project.participants.length === 1;
}

export function isSharedProjectWorkspace(project: DiscussionProject) {
  return !isProtectedSampleProject(project)
    && (project.room.visibility !== "private" || project.participants.length > 1);
}

export interface ProjectAccessState {
  localIdentityId: string;
  workspaceRole: "host" | "admin" | "member" | "viewer" | "guest";
  isSample: boolean;
  isProtectedSample: boolean;
  isMember: boolean;
  isOwner: boolean;
  isAdmin: boolean;
  isPublicViewer: boolean;
  canRead: boolean;
  canJoinPublicRoom: boolean;
  canModerate: boolean;
  canEditWorkspace: boolean;
  canManageParticipants: boolean;
  canManageRoom: boolean;
  canManageAutomation: boolean;
  canCreateInvites: boolean;
  canRunAiTasks: boolean;
  canPostMessages: boolean;
  canUpdatePresence: boolean;
  canUploadAttachments: boolean;
  canKickUsers: boolean;
  canAssignRoles: boolean;
  canTransferOwnership: boolean;
  canDestroyRoom: boolean;
  ownedParticipants: Participant[];
  ownedParticipantIds: string[];
  messageParticipants: Participant[];
  presenceParticipants: Participant[];
  uploadParticipants: Participant[];
}

export function getProjectAccessState(project: DiscussionProject, settings: AppSettings): ProjectAccessState {
  const localIdentityId = settings.profile.localIdentityId;
  const isSample = project.metadata.isSample;
  const isProtectedSample = isProtectedSampleProject(project);
  const explicitOwnedParticipants = project.participants.filter((participant) => participant.profileOwnerId === localIdentityId);
  const sampleDemoParticipant = isSample && explicitOwnedParticipants.length === 0
    ? (
        project.participants.find((participant) => participant.collaborationRole === "host")
        ?? project.participants.find((participant) => participant.role === "moderator")
        ?? project.participants[0]
      )
    : undefined;
  // Samples should stay protected, but they should not fall onto a totally separate
  // "anonymous viewer" path because that causes the UI tree and behavior to diverge
  // from normal workspaces.
  const ownedParticipants = explicitOwnedParticipants.length > 0
    ? explicitOwnedParticipants
    : sampleDemoParticipant
      ? [sampleDemoParticipant]
      : [];
  const ownedParticipantIds = ownedParticipants.map((participant) => participant.id);
  const isMember = ownedParticipants.length > 0;
  const isPublicViewer = !isSample && !isMember && project.room.visibility === "public";
  const canRead = isSample || isMember || project.room.visibility === "public";
  const canJoinPublicRoom = !isSample && !isMember && project.room.visibility === "public";
  const canModerate = ownedParticipants.some(isModeratorParticipant);
  const ownerStatus = ownedParticipants.some(isOwner);
  const adminStatus = ownedParticipants.some(isAdmin);
  const observerOnly = isMember && ownedParticipants.every((participant) => participant.collaborationRole === "observer");
  const automationPermissions = project.room.aiAutomation?.permissions;
  const canEditWorkspace = !isProtectedSample && canModerate;
  const canManageParticipants = !isProtectedSample && canModerate;
  const canManageRoom = !isProtectedSample && canModerate;
  const canManageAutomation = !isProtectedSample && (ownerStatus || (adminStatus && Boolean(automationPermissions?.facilitatorCanManage)));
  const canCreateInvites = !isProtectedSample && canModerate && settings.collaborationPreferences.allowInvites && project.room.visibility !== "private";
  const canRunAiTasks = (project.scenario === "ai-dialogue" && isMember)
    || (!isProtectedSample && (ownerStatus || (adminStatus && Boolean(automationPermissions?.facilitatorCanTrigger))));
  const isWorkspaceArchived = isProjectWorkspaceArchived(project);
  const sampleReadOnly = isProtectedSample || isWorkspaceArchived;
  const messageParticipants = ownedParticipants.filter((participant) => participant.collaborationRole !== "observer");
  const presenceParticipants = canManageParticipants ? project.participants : ownedParticipants;
  const uploadParticipants = ownedParticipants.filter((participant) => participant.collaborationRole !== "observer");
  const workspaceRole: ProjectAccessState["workspaceRole"] = isPublicViewer
    ? "guest"
    : ownerStatus
      ? "host"
      : adminStatus
        ? "admin"
        : observerOnly
          ? "viewer"
          : isMember
            ? "member"
            : "guest";

  return {
    localIdentityId,
    workspaceRole,
    isSample,
    isProtectedSample,
    isMember,
    isOwner: ownerStatus,
    isAdmin: adminStatus,
    isPublicViewer,
    canRead,
    canJoinPublicRoom: canJoinPublicRoom && !isWorkspaceArchived,
    canModerate,
    canEditWorkspace: canEditWorkspace && !isWorkspaceArchived,
    canManageParticipants: canManageParticipants && !isWorkspaceArchived,
    canManageRoom: canManageRoom && !isWorkspaceArchived,
    canManageAutomation: canManageAutomation && !isWorkspaceArchived,
    canCreateInvites: canCreateInvites && !isWorkspaceArchived,
    canRunAiTasks: canRunAiTasks && !isWorkspaceArchived,
    canPostMessages: !sampleReadOnly && messageParticipants.length > 0,
    canUpdatePresence: !sampleReadOnly && presenceParticipants.length > 0,
    canUploadAttachments: !sampleReadOnly && uploadParticipants.length > 0,
    canKickUsers: !isProtectedSample && (ownerStatus || adminStatus) && !isWorkspaceArchived,
    canAssignRoles: !isProtectedSample && ownerStatus && !isWorkspaceArchived,
    canTransferOwnership: !isProtectedSample && ownerStatus && !isWorkspaceArchived,
    canDestroyRoom: !isProtectedSample && ownerStatus,
    ownedParticipants,
    ownedParticipantIds,
    messageParticipants,
    presenceParticipants,
    uploadParticipants,
  };
}

export function getProjectDisplayAccessState(project: DiscussionProject, settings: AppSettings): ProjectAccessState {
  const access = getProjectAccessState(project, settings);
  if (!access.isProtectedSample) return access;

  const isWorkspaceArchived = isProjectWorkspaceArchived(project);
  const canWriteLikeOwner = !isWorkspaceArchived && access.canModerate;
  const canRunAiTasks = !isWorkspaceArchived
    && (project.scenario === "ai-dialogue" || access.isOwner || access.isAdmin);

  return {
    ...access,
    // Display access is intentionally decoupled from protected-sample write access.
    // API/repository/collaboration guards still block real mutations for bundled samples.
    isProtectedSample: false,
    canJoinPublicRoom: false,
    canEditWorkspace: canWriteLikeOwner,
    canManageParticipants: canWriteLikeOwner,
    canManageRoom: canWriteLikeOwner,
    canManageAutomation: canRunAiTasks,
    canCreateInvites: canWriteLikeOwner && settings.collaborationPreferences.allowInvites && project.room.visibility !== "private",
    canRunAiTasks,
    canPostMessages: !isWorkspaceArchived && access.messageParticipants.length > 0,
    canUpdatePresence: false,
    canUploadAttachments: !isWorkspaceArchived && access.uploadParticipants.length > 0,
    canKickUsers: canWriteLikeOwner && (access.isOwner || access.isAdmin),
    canAssignRoles: canWriteLikeOwner && access.isOwner,
    canTransferOwnership: canWriteLikeOwner && access.isOwner,
    canDestroyRoom: canWriteLikeOwner && access.isOwner,
    presenceParticipants: project.participants,
  };
}

export function canRemoveParticipant(
  project: DiscussionProject,
  access: ProjectAccessState,
  participant: Participant,
) {
  if (!access.canKickUsers) return false;
  if (project.participants.length <= 1) return false;
  // Cannot kick yourself if you're the owner
  if (participant.profileOwnerId === access.localIdentityId && participant.collaborationRole === "host") return false;
  // Owners can kick anyone
  if (access.isOwner) return true;
  // Admins can kick regular members/observers, but NOT other admins or the owner
  if (access.isAdmin) {
    return participant.collaborationRole !== "host" && participant.collaborationRole !== "facilitator";
  }
  return false;
}

/** Check if the current user can change another participant's role. */
export function canChangeParticipantRole(
  access: ProjectAccessState,
  targetParticipant: Participant,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _newRole: CollaborationRole,
) {
  if (!access.canAssignRoles) return false;
  // Only owner can assign roles
  // Cannot change own role (must transfer ownership instead)
  if (targetParticipant.profileOwnerId === access.localIdentityId) return false;
  return true;
}

export function canEditParticipantIdentity(access: ProjectAccessState, participant: Participant) {
  if (!access.canManageParticipants) return false;
  return !participant.profileOwnerId;
}

export function canEditParticipantRoomMetadata(access: ProjectAccessState, participant: Participant) {
  if (access.canManageParticipants) return true;
  return participant.profileOwnerId === access.localIdentityId;
}
