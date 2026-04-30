import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "@/lib/atomic-file";
import { getSettingsForIdentity } from "@/lib/data/repository";

export interface NotificationEntry {
  id: string;
  timestamp: string;
  type: "message" | "mention" | "ai_summary" | "member_join" | "member_kick" | "role_change" | "email_trigger";
  title: string;
  body: string;
  projectId?: string;
  read: boolean;
  href?: string;
}

const notifRoot = path.join(process.cwd(), "data", "notifications");
const notificationQueues = new Map<string, Promise<void>>();

async function ensureDir() {
  try { await mkdir(notifRoot, { recursive: true }); } catch { /* exists */ }
}

function notifFile(userId: string) {
  return path.join(notifRoot, `${userId}.json`);
}

async function canStoreNotification(userId: string, type: NotificationEntry["type"]) {
  if (type === "email_trigger") {
    return true;
  }

  try {
    const settings = await getSettingsForIdentity(userId, { includeSecrets: false });
    if (!settings) {
      return true;
    }
    if (!settings.collaborationPreferences.notificationsEnabled) {
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

export async function appendNotification(userId: string, entry: Omit<NotificationEntry, "id" | "timestamp" | "read">) {
  if (!(await canStoreNotification(userId, entry.type))) {
    return null;
  }

  const full: NotificationEntry = {
    ...entry,
    id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    read: false,
  };
  await mutateNotifications(userId, (entries) => {
    entries.push(full);
    return entries.length > 200 ? entries.slice(-200) : entries;
  });
  return full;
}

export async function getNotifications(userId: string): Promise<NotificationEntry[]> {
  try {
    return (JSON.parse(await readFile(notifFile(userId), "utf-8")) as NotificationEntry[]).reverse();
  } catch { return []; }
}

export async function markAllRead(userId: string) {
  await mutateNotifications(userId, (entries) => entries.map((entry) => ({ ...entry, read: true })));
}

export async function markOneRead(userId: string, notifId: string) {
  await mutateNotifications(userId, (entries) => entries.map((entry) => (
    entry.id === notifId ? { ...entry, read: true } : entry
  )));
}

export async function deleteNotification(userId: string, notifId: string) {
  await mutateNotifications(userId, (entries) => entries.filter((entry) => entry.id !== notifId));
}

export async function clearAllNotifications(userId: string) {
  await mutateNotifications(userId, () => []);
}

async function readNotificationsFile(userId: string) {
  await ensureDir();
  try {
    return JSON.parse(await readFile(notifFile(userId), "utf-8")) as NotificationEntry[];
  } catch {
    return [];
  }
}

async function writeNotificationsFile(userId: string, entries: NotificationEntry[]) {
  await ensureDir();
  await writeFileAtomic(notifFile(userId), JSON.stringify(entries, null, 2), "utf-8");
}

async function mutateNotifications(
  userId: string,
  updater: (entries: NotificationEntry[]) => NotificationEntry[] | Promise<NotificationEntry[]>,
) {
  const previous = notificationQueues.get(userId) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(async () => {
      const nextEntries = await updater(await readNotificationsFile(userId));
      await writeNotificationsFile(userId, nextEntries);
    });

  notificationQueues.set(userId, current);
  try {
    await current;
  } finally {
    if (notificationQueues.get(userId) === current) {
      notificationQueues.delete(userId);
    }
  }
}
