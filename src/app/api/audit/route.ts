export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAuditLog } from "@/lib/audit";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId") ?? undefined;
  const entries = await getAuditLog(projectId);
  return NextResponse.json({ entries: entries.slice(0, 100) });
}
