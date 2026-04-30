import { AppSettings, AvatarPreset, AVATAR_PRESETS, Participant } from "@/lib/types";
import { normalizeAvatarLabel, pickInitials } from "@/lib/utils";

export const avatarPresetStyles: Record<AvatarPreset, { background: string; ink: string; ring: string; shadow: string }> = {
  ember: {
    background: "linear-gradient(135deg, #9a3412 0%, #c2410c 54%, #ef4444 100%)",
    ink: "#fff7f2",
    ring: "rgba(194, 65, 12, 0.26)",
    shadow: "0 18px 34px rgba(194, 65, 12, 0.2)",
  },
  harbor: {
    background: "linear-gradient(135deg, #0f766e 0%, #14b8a6 58%, #67e8f9 100%)",
    ink: "#effffb",
    ring: "rgba(20, 184, 166, 0.24)",
    shadow: "0 18px 34px rgba(20, 184, 166, 0.2)",
  },
  forest: {
    background: "linear-gradient(135deg, #166534 0%, #16a34a 58%, #65a30d 100%)",
    ink: "#f7fff4",
    ring: "rgba(22, 163, 74, 0.24)",
    shadow: "0 18px 34px rgba(22, 163, 74, 0.2)",
  },
  plum: {
    background: "linear-gradient(135deg, #6d28d9 0%, #9333ea 56%, #f472b6 100%)",
    ink: "#fff7ff",
    ring: "rgba(147, 51, 234, 0.24)",
    shadow: "0 18px 34px rgba(147, 51, 234, 0.2)",
  },
  graphite: {
    background: "linear-gradient(135deg, #334155 0%, #475569 55%, #64748b 100%)",
    ink: "#f8fafc",
    ring: "rgba(100, 116, 139, 0.24)",
    shadow: "0 18px 34px rgba(51, 65, 85, 0.2)",
  },
  aurora: {
    background: "linear-gradient(135deg, #2563eb 0%, #0891b2 52%, #14b8a6 100%)",
    ink: "#f3fbff",
    ring: "rgba(37, 99, 235, 0.22)",
    shadow: "0 18px 34px rgba(37, 99, 235, 0.2)",
  },
  sunrise: {
    background: "linear-gradient(135deg, #ec4899 0%, #fb7185 48%, #facc15 100%)",
    ink: "#fff9f4",
    ring: "rgba(244, 114, 182, 0.22)",
    shadow: "0 18px 34px rgba(244, 114, 182, 0.2)",
  },
  cobalt: {
    background: "linear-gradient(135deg, #1d4ed8 0%, #4338ca 52%, #7c3aed 100%)",
    ink: "#f5f7ff",
    ring: "rgba(67, 56, 202, 0.22)",
    shadow: "0 18px 34px rgba(29, 78, 216, 0.2)",
  },
};

const avatarDataUrlPattern = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i;

export function isAvatarPreset(value: unknown): value is AvatarPreset {
  return typeof value === "string" && (AVATAR_PRESETS as readonly string[]).includes(value);
}

export function deriveAvatarPreset(seed: string) {
  const normalized = seed.trim() || "dialectica";
  const hash = [...normalized].reduce((total, char, index) => (total + char.charCodeAt(0) * (index + 17)) % 104729, 13);
  return AVATAR_PRESETS[hash % AVATAR_PRESETS.length];
}

export function normalizeAvatarPreset(value: unknown, fallbackSeed = "dialectica") {
  return isAvatarPreset(value) ? value : deriveAvatarPreset(fallbackSeed);
}

export function sanitizeAvatarDataUrl(value: string | undefined, maxLength = 900_000) {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || !avatarDataUrlPattern.test(trimmed)) {
    return "";
  }
  return trimmed.replace(/\s+/g, "");
}

export function resolveProfileAvatar(profile: AppSettings["profile"]) {
  return {
    label: pickInitials(profile.displayName),
    preset: normalizeAvatarPreset(profile.avatarPreset, profile.displayName),
    imageDataUrl: sanitizeAvatarDataUrl(profile.avatarImageDataUrl),
  };
}

export function resolveParticipantAvatar(participant: Participant, profile?: AppSettings["profile"]) {
  const participantPreset = normalizeAvatarPreset(participant.avatarPreset, participant.name || participant.avatarLabel || profile?.displayName || "dialectica");
  const participantImageDataUrl = sanitizeAvatarDataUrl(participant.avatarImageDataUrl);

  return {
    label:
      normalizeAvatarLabel(participant.avatarLabel || "")
      || pickInitials(participant.name)
      || pickInitials(profile?.displayName ?? "")
      || "DL",
    preset: participantPreset,
    imageDataUrl: participantImageDataUrl,
  };
}


