import Image from "next/image";
import { clsx } from "clsx";
import { AppSettings, AvatarPreset } from "@/lib/types";
import { avatarPresetStyles, deriveAvatarPreset, sanitizeAvatarDataUrl } from "@/lib/avatar";
import { normalizeAvatarLabel, pickInitials } from "@/lib/utils";

export function Avatar({
  name,
  label,
  preset,
  imageDataUrl,
  className,
  title,
}: {
  name: string;
  label?: string;
  preset?: AvatarPreset;
  imageDataUrl?: string;
  className?: string;
  title?: string;
}) {
  const resolvedPreset = preset ?? deriveAvatarPreset(name || label || "dialectica");
  const palette = avatarPresetStyles[resolvedPreset];
  const safeImage = sanitizeAvatarDataUrl(imageDataUrl);
  const normalizedLabel = normalizeAvatarLabel(label || "");
  const initials = normalizedLabel || pickInitials(name) || "DL";

  return (
    <span
      title={title ?? name}
      className={clsx(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden border text-center font-semibold ring-2 ring-white/20 transition-transform duration-200",
        className ?? "h-11 w-11 rounded-2xl text-sm",
      )}
      style={{
        borderColor: palette.ring,
        backgroundImage: safeImage ? undefined : palette.background,
        color: safeImage ? undefined : palette.ink,
        boxShadow: safeImage ? undefined : palette.shadow,
      }}
    >
      {safeImage ? (
        <Image src={safeImage} alt={name} fill unoptimized sizes="80px" className="object-cover" />
      ) : (
        <span className="pointer-events-none relative z-10 select-none">{initials}</span>
      )}
    </span>
  );
}

export function ProfileAvatar({
  profile,
  className,
}: {
  profile: AppSettings["profile"];
  className?: string;
}) {
  return (
    <Avatar
      name={profile.displayName}
      label={pickInitials(profile.displayName)}
      preset={profile.avatarPreset}
      imageDataUrl={profile.avatarImageDataUrl}
      className={className}
    />
  );
}
