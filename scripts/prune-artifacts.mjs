import { rm, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const toolsDir = path.join(root, ".tools");
const removed = [];

async function removeTarget(targetPath) {
  try {
    await rm(targetPath, { recursive: true, force: true });
    removed.push(path.relative(root, targetPath));
  } catch {}
}

async function main() {
  await removeTarget(path.join(root, "tsconfig.tsbuildinfo"));
  await removeTarget(path.join(root, ".test-dist"));
  await removeTarget(path.join(root, ".npm-cache"));
  await removeTarget(path.join(root, ".tmp-i18n"));
  await removeTarget(path.join(root, "scripts", "log-spawn.cjs"));

  try {
    const entries = await readdir(toolsDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(toolsDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "npm-cache" || /^node-v\d+\.\d+\.\d+-win-x64$/i.test(entry.name)) {
          await removeTarget(fullPath);
        }
        continue;
      }

      if (/\.(log|out\.log|err\.log)$/i.test(entry.name)) {
        await removeTarget(fullPath);
        continue;
      }

      if (/^node-v\d+\.\d+\.\d+-win-x64\.zip$/i.test(entry.name)) {
        await removeTarget(fullPath);
        continue;
      }

      if ([
        "alias-loader.mjs",
        "direct-dev.cjs",
        "final-smoke.mjs",
        "phase5-smoke.cjs",
        "phase6-smoke.ps1",
        "phase6-run-smoke.ps1",
        "resolve-playwright.cjs",
        "run-next-3028.cmd",
        "run-next-build.mjs",
        "start-next-3065.ps1",
        "start-phase10-dev.cmd",
      ].includes(entry.name)) {
        await removeTarget(fullPath);
      }
    }
  } catch {}

  console.log(JSON.stringify({ removed }, null, 2));
}

await main();
