import { randomBytes } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";

export async function writeFileAtomic(
  targetPath: string,
  data: string | Uint8Array,
  encoding?: BufferEncoding,
) {
  const directory = path.dirname(targetPath);
  await mkdir(directory, { recursive: true });

  const tempPath = path.join(
    directory,
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.${randomBytes(6).toString("hex")}.tmp`,
  );

  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(tempPath, "w", 0o600);
    await handle.writeFile(data, encoding);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(tempPath, targetPath);
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => undefined);
    }
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}
