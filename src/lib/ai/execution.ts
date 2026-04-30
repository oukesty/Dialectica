import { getSettingsForIdentity } from "@/lib/data/repository";
import { hasAvailableProviderApiKey } from "@/lib/providers/runtime";
import { getProviderDescriptor, isProviderModelSupported, normalizeProviderModel } from "@/lib/providers/provider-catalog";
import { AppSettings, DiscussionProject, Participant, ProviderId, ProviderRuntimeConfig } from "@/lib/types";

export interface RoomAiExecutionContext {
  controllerParticipant?: Participant;
  currentIdentityControlsSoloRoom: boolean;
  executionSettings: AppSettings | null;
  ownerSettings: AppSettings | null;
  providerId: ProviderId;
  providerConfig: ProviderRuntimeConfig | null;
  requestedModel: string;
  normalizedModel: string;
  hasAvailableCredentials: boolean;
  modelSupported: boolean;
}

export function resolveRoomAiController(project: DiscussionProject) {
  return project.participants.find((participant) => participant.id === project.room.aiConfig.ownerParticipantId)
    ?? project.participants.find((participant) => participant.profileOwnerId === project.room.aiConfig.ownerIdentityId)
    ?? project.participants.find((participant) => participant.id === project.room.session.hostParticipantId)
    ?? project.participants[0];
}

export async function resolveRoomAiExecutionContext(
  project: DiscussionProject,
  viewerSettings: AppSettings,
): Promise<RoomAiExecutionContext> {
  const controllerParticipant = resolveRoomAiController(project);
  const roomAiConfig = project.room.aiConfig;
  const singleUserMode = project.scenario === "ai-dialogue" && project.participants.length === 1;
  const currentIdentityControlsSoloRoom = singleUserMode && Boolean(
    roomAiConfig.ownerIdentityId === viewerSettings.profile.localIdentityId
    || controllerParticipant?.profileOwnerId === viewerSettings.profile.localIdentityId,
  );

  const ownerSettings = currentIdentityControlsSoloRoom
    ? viewerSettings
    : roomAiConfig.ownerIdentityId
      ? await getSettingsForIdentity(roomAiConfig.ownerIdentityId)
      : null;

  const executionSettings = currentIdentityControlsSoloRoom
    ? viewerSettings
    : ownerSettings ?? (
      project.metadata.isSample || roomAiConfig.ownerIdentityId === viewerSettings.profile.localIdentityId
        ? viewerSettings
        : null
    );

  const providerId: ProviderId = currentIdentityControlsSoloRoom
    ? viewerSettings.provider.activeProviderId
    : roomAiConfig.providerId;

  const providerConfig = executionSettings?.provider.providers[providerId] ?? null;
  const requestedModel = currentIdentityControlsSoloRoom
    ? (providerConfig?.model ?? "")
    : roomAiConfig.model || providerConfig?.model || "";
  const normalizedModel = normalizeProviderModel(providerId, requestedModel);

  return {
    controllerParticipant,
    currentIdentityControlsSoloRoom,
    executionSettings,
    ownerSettings,
    providerId,
    providerConfig,
    requestedModel,
    normalizedModel,
    hasAvailableCredentials: Boolean(
      executionSettings
      && providerConfig
      && hasAvailableProviderApiKey(providerId, providerConfig, {
        preferServerKeys: executionSettings.provider.preferServerKeys,
      }),
    ),
    modelSupported: !requestedModel || isProviderModelSupported(providerId, requestedModel),
  };
}

export function buildProviderExecutionConfig(
  providerId: ProviderId,
  providerConfig: ProviderRuntimeConfig,
  normalizedModel: string,
) {
  const descriptor = getProviderDescriptor(providerId);
  return {
    ...providerConfig,
    model: normalizedModel,
    mode: descriptor?.mode ?? providerConfig.mode,
  };
}
