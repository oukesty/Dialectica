import type { NotificationEntry } from "@/lib/notifications";
import type { AppSettings } from "@/lib/types";
import { appendNotification, canStoreNotification } from "@/lib/notifications";

export type ExternalEmailProviderStatus = {
  configured: false;
  providerId: "none";
};

export type EmailNotificationAttempt = {
  status: "suppressed_by_preferences" | "not_configured";
  provider: ExternalEmailProviderStatus;
  notification: NotificationEntry | null;
};

export function getExternalEmailProviderStatus(): ExternalEmailProviderStatus {
  return {
    configured: false,
    providerId: "none",
  };
}

export async function recordEmailNotificationAttempt(
  userId: string,
  settings: Pick<AppSettings, "emailNotifications">,
  entry: Omit<NotificationEntry, "id" | "timestamp" | "read" | "type">,
): Promise<EmailNotificationAttempt> {
  const provider = getExternalEmailProviderStatus();
  if (!settings.emailNotifications.enabled) {
    return {
      status: "suppressed_by_preferences",
      provider,
      notification: null,
    };
  }
  if (!(await canStoreNotification(userId))) {
    return {
      status: "suppressed_by_preferences",
      provider,
      notification: null,
    };
  }

  const notification = await appendNotification(userId, {
    ...entry,
    type: "email_trigger",
  });

  return {
    status: "not_configured",
    provider,
    notification,
  };
}
