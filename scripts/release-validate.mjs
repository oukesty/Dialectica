import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const gitIgnoreRequirements = [
  "data/settings.json",
  "data/projects/",
  "data/audit/",
  "data/notifications/",
  "data/collaboration/",
  "data/knowledge/",
  "data/profiles/",
  "data/provider-secrets/",
  "data/attachments/",
  "data/uploads/",
  "uploads/",
  "provider-secrets/",
  "cache/",
  ".cache/",
  ".npm-cache/",
  ".tmp/",
  ".tools/",
  "output/",
  "*.log",
  ".env*",
];

const dockerIgnoreRequirements = [
  "data/",
  "uploads/",
  "provider-secrets/",
  "cache/",
  ".cache/",
  ".npm-cache/",
  ".tmp/",
  ".tools/",
  ".next",
  "node_modules",
  "output/",
  "*.log",
  ".env*",
];

const disallowedTrackedPrefixes = [
  "data/",
  "uploads/",
  "provider-secrets/",
  "cache/",
  ".cache/",
  ".npm-cache/",
  ".tmp/",
  ".tools/",
  "output/",
  "coverage/",
  ".next/",
];

const localRiskPaths = [
  "data",
  "uploads",
  "provider-secrets",
  "cache",
  ".cache",
  ".npm-cache",
  ".tmp",
  ".tools",
  "output",
];

function normalizePath(value) {
  return value.replace(/\\/g, "/");
}

function readIgnoreLines(fileName) {
  const filePath = path.join(ROOT, fileName);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function hasIgnorePattern(lines, requiredPattern) {
  const normalized = requiredPattern.replace(/\\/g, "/");
  const slashVariant = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const noTrailingSlash = normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  return lines.some((line) => line === normalized || line === slashVariant || line === noTrailingSlash);
}

function getTrackedFiles() {
  const output = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" });
  return output
    .split(/\r?\n/)
    .map((line) => normalizePath(line.trim()))
    .filter(Boolean);
}

const failures = [];
const warnings = [];

const gitIgnoreLines = readIgnoreLines(".gitignore");
if (!gitIgnoreLines) {
  failures.push(".gitignore is missing.");
} else {
  for (const pattern of gitIgnoreRequirements) {
    if (!hasIgnorePattern(gitIgnoreLines, pattern)) {
      failures.push(`.gitignore is missing required release protection: ${pattern}`);
    }
  }
}

const dockerIgnoreLines = readIgnoreLines(".dockerignore");
if (!dockerIgnoreLines) {
  failures.push(".dockerignore is missing.");
} else {
  for (const pattern of dockerIgnoreRequirements) {
    if (!hasIgnorePattern(dockerIgnoreLines, pattern)) {
      failures.push(`.dockerignore is missing required Docker context protection: ${pattern}`);
    }
  }
}

let trackedFiles = [];
try {
  trackedFiles = getTrackedFiles();
} catch (error) {
  const errorName = error instanceof Error ? error.name : "UnknownError";
  failures.push(`Unable to inspect tracked files with git ls-files: ${errorName}`);
}

for (const file of trackedFiles) {
  if (file === "data/.gitkeep") continue;
  if (disallowedTrackedPrefixes.some((prefix) => file === prefix.slice(0, -1) || file.startsWith(prefix))) {
    failures.push(`Release-sensitive local artifact is tracked: ${file}`);
  }
  if (file.startsWith(".env") && ![".env.example", ".env.sample", ".env.template"].includes(file)) {
    failures.push(`Environment file is tracked: ${file}`);
  }
  if (file.endsWith(".log")) {
    failures.push(`Log file is tracked: ${file}`);
  }
}

for (const candidate of localRiskPaths) {
  const absolute = path.join(ROOT, candidate);
  if (fs.existsSync(absolute)) {
    warnings.push(`${candidate}/ exists locally; release validation confirmed it is ignored and must not be copied into deployment bundles.`);
  }
}

for (const warning of warnings) {
  console.warn(`[release:validate] WARN ${warning}`);
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`[release:validate] FAIL ${failure}`);
  }
  process.exit(1);
}

console.log("[release:validate] OK release data boundaries are protected.");
