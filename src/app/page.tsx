import { redirect } from "next/navigation";
import { getSettings } from "@/lib/data/repository";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  const settings = await getSettings({ includeSecrets: false });
  redirect(`/${settings.locale}`);
}

