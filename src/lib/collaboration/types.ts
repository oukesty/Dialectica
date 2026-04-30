import { AiTask, CollaborationRole, PresenceStatus } from "@/lib/types";

export const ATTACHMENT_KINDS = ["document", "image", "video", "file"] as const;
export const INVITE_STATUSES = ["active", "accepted", "revoked", "expired"] as const;
export const COLLABORATION_EVENT_TYPES = ["message", "system", "invite", "presence", "attachment", "join", "leave"] as const;
export const COLLABORATION_TRANSPORTS = ["local-poll", "future-websocket", "future-sse"] as const;
export const EVENT_ACTOR_TYPES = ["participant", "system", "ai"] as const;

export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];
export type InviteStatus = (typeof INVITE_STATUSES)[number];
export type CollaborationEventType = (typeof COLLABORATION_EVENT_TYPES)[number];
export type CollaborationTransport = (typeof COLLABORATION_TRANSPORTS)[number];
export type EventActorType = (typeof EVENT_ACTOR_TYPES)[number];

export interface RoomInvite {
  id: string;
  token: string;
  inviteUrl: string;
  role: CollaborationRole;
  status: InviteStatus;
  createdAt: string;
  createdByParticipantId?: string;
  expiresAt?: string;
  acceptedAt?: string;
  acceptedByParticipantName?: string;
  note: string;
}

export interface CollaborationPresence {
  participantId: string;
  participantName: string;
  role: CollaborationRole;
  status: PresenceStatus;
  isTyping: boolean;
  connectionId: string;
  sessionId: string;
  lastHeartbeatAt: string;
  active: boolean;
}

export interface RoomAttachment {
  id: string;
  name: string;
  kind: AttachmentKind;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedByParticipantId?: string;
  storage: "local" | "external";
  localPath?: string;
  publicUrl?: string;
  note: string;
  previewText?: string;
}

export interface CollaborationEvent {
  id: string;
  type: CollaborationEventType;
  createdAt: string;
  participantId?: string;
  participantName?: string;
  role?: CollaborationRole;
  actorType?: EventActorType;
  aiTask?: AiTask | "knowledgeExtraction";
  message: string;
  replyToEventId?: string;
  mentions?: string[];
  reactions?: Record<string, string[]>;
  editedAt?: string;
  pinned?: boolean;
  pinnedAt?: string;
  pinnedBy?: string;
  attachmentIds: string[];
  metadata: Record<string, string>;
  revisions?: CollaborationEventRevision[];
  activeRevisionId?: string;
}

export interface CollaborationEventRevision {
  id: string;
  content: string;
  createdAt: string;
  providerId?: string;
  model?: string;
  reasoning?: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  action: string;
  actorId?: string;
  actorName?: string;
  details?: string;
}

export interface CollaborationSyncSnapshot {
  transport: CollaborationTransport;
  updatedAt: string;
  heartbeatAt: string;
  onlineCount: number;
  typingParticipantIds: string[];
  lastEventId?: string;
  cursor: number;
}

export interface CollaborationState {
  projectId: string;
  roomId: string;
  invites: RoomInvite[];
  presence: CollaborationPresence[];
  attachments: RoomAttachment[];
  events: CollaborationEvent[];
  sync: CollaborationSyncSnapshot;
  version: number;
}
