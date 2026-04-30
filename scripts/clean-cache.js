/**
 * Pre-dev cache cleaner — runs before `npm run dev`.
 *
 * What it does:
 *   1. Checks .next/ size — deletes if > 200 MB
 *   2. Removes root-level *.log files and temporary cache dirs
 *   3. Warns (never deletes) if data/ > 500 MB
 *
 * What it NEVER does:
 *   - Delete source code (src/)
 *   - Delete user data (data/projects, data/uploads, etc.)
 *   - Delete dependencies (node_modules/)
 *   - Delete config files
 *   - Delete cache-cleaning scripts or repository metadata
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function dirSizeBytes(dir) {
  let total = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        total += dirSizeBytes(full);
      } else {
        try {
          total += fs.statSync(full).size;
        } catch {
          // skip inaccessible files
        }
      }
    }
  } catch {
    // directory doesn't exist or can't be read
  }
  return total;
}

function mb(bytes) {
  return (bytes / 1024 / 1024).toFixed(1);
}

function rmSafe(target) {
  try {
    fs.rmSync(path.join(ROOT, target), { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

// 1. Check .next/ cache size
const nextDir = path.join(ROOT, ".next");
if (fs.existsSync(nextDir)) {
  const nextSize = dirSizeBytes(nextDir);
  if (nextSize > 200 * 1024 * 1024) {
    rmSafe(".next");
    console.log(`[Clean] .next cache exceeded 200 MB (${mb(nextSize)} MB) — cleaned`);
  } else {
    console.log(`[Clean] .next cache OK (${mb(nextSize)} MB)`);
  }
}

// 2. Clean root-level junk
const rootFiles = fs.readdirSync(ROOT);
let cleaned = [];
for (const file of rootFiles) {
  const full = path.join(ROOT, file);
  try {
    const stat = fs.statSync(full);
    if (stat.isFile() && file.endsWith(".log")) {
      fs.unlinkSync(full);
      cleaned.push(file);
    }
  } catch {
    // skip
  }
}
if (rmSafe(".tmp")) cleaned.push(".tmp/");
if (rmSafe(".tools")) cleaned.push(".tools/");
if (rmSafe("output")) cleaned.push("output/");
if (rmSafe(".npm-cache")) cleaned.push(".npm-cache/");
if (rmSafe(".tmp-i18n")) cleaned.push(".tmp-i18n/");

if (cleaned.length > 0) {
  console.log(`[Clean] Removed junk: ${cleaned.join(", ")}`);
}

// 3. Warn about data/ size (never delete)
const dataDir = path.join(ROOT, "data");
if (fs.existsSync(dataDir)) {
  const dataSize = dirSizeBytes(dataDir);
  if (dataSize > 500 * 1024 * 1024) {
    console.log(`[Warning] data/ directory is large (${mb(dataSize)} MB) — consider manually cleaning old data`);
  }
}
