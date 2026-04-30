export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getSettings } from "@/lib/data/repository";
import { getUserGraph } from "@/lib/knowledge/user-graphs";
import { clearAllNotifications, deleteNotification, getNotifications, markAllRead, markOneRead } from "@/lib/notifications";
import { NotificationEntry } from "@/lib/notifications";

type NotificationResponseEntry = NotificationEntry & {
  linkState?: "ready" | "generating" | "deleted";
};

async function resolveNotificationLinkState(
  entry: NotificationEntry,
  viewer: { identityId: string; displayName?: string },
): Promise<NotificationResponseEntry> {
  if (!entry.href) {
    return entry;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(entry.href, "http://localhost");
  } catch {
    return entry;
  }

  const isKnowledgeGraphLink = parsedUrl.pathname.endsWith("/knowledge/graph");
  const graphId = parsedUrl.searchParams.get("graphId");
  if (!isKnowledgeGraphLink || !graphId) {
    return entry;
  }

  const graph = await getUserGraph(graphId, viewer);
  if (!graph) {
    return { ...entry, href: undefined, linkState: "deleted" };
  }
  if (graph.status !== "ready") {
    return { ...entry, href: undefined, linkState: "generating" };
  }

  return { ...entry, linkState: "ready" };
}

export async function GET() {
  const settings = await getSettings();
  const viewer = {
    identityId: settings.profile.localIdentityId,
    displayName: settings.profile.displayName,
  };
  const entries = await getNotifications(settings.profile.localIdentityId);
  const resolvedEntries = await Promise.all(entries.map((entry) => resolveNotificationLinkState(entry, viewer)));
  const unreadCount = resolvedEntries.filter((e) => !e.read).length;
  return NextResponse.json({ entries: resolvedEntries.slice(0, 50), unreadCount });
}

export async function POST(request: Request) {
  const settings = await getSettings();
  const body = (await request.json().catch(() => ({}))) as { action?: string; notifId?: string };

  if (body.action === "delete" && body.notifId) {
    await deleteNotification(settings.profile.localIdentityId, body.notifId);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "markRead" && body.notifId) {
    await markOneRead(settings.profile.localIdentityId, body.notifId);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "clearAll") {
    await clearAllNotifications(settings.profile.localIdentityId);
    return NextResponse.json({ ok: true });
  }

  // Default: mark all read
  await markAllRead(settings.profile.localIdentityId);
  return NextResponse.json({ ok: true });
}
