import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const projectRoot = process.cwd();
const outRoot = path.join(projectRoot, ".test-dist");
const requireFromRoot = createRequire(import.meta.url);

async function listFiles(dir, files = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await listFiles(fullPath, files);
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

function shouldCompile(filePath) {
  return /\.(ts|tsx|json)$/.test(filePath) && !/\.d\.ts$/.test(filePath);
}

function rewriteSpecifiers(code, outFile) {
  const outDir = path.dirname(outFile);
  const rewriteAlias = (specifier) => {
    const target = path.join(outRoot, "src", specifier.slice(2));
    const relativePath = path.relative(outDir, target).replace(/\\/g, "/");
    return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
  };
  const rewriteVitest = () => {
    const target = path.join(outRoot, "tests", "vitest-lite");
    const relativePath = path.relative(outDir, target).replace(/\\/g, "/");
    return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
  };

  return code
    .replace(/require\(["'](@\/[^"']+)["']\)/g, (_, specifier) => `require("${rewriteAlias(specifier)}")`)
    .replace(/require\(["']vitest["']\)/g, () => `require("${rewriteVitest()}")`);
}

async function emitFile(sourceFile) {
  const relativePath = path.relative(projectRoot, sourceFile);
  const outFile = path.join(outRoot, relativePath).replace(/\.(ts|tsx)$/, ".js");
  await mkdir(path.dirname(outFile), { recursive: true });

  if (sourceFile.endsWith(".json")) {
    await writeFile(outFile, await readFile(sourceFile));
    return;
  }

  const sourceText = await readFile(sourceFile, "utf8");
  const transpiled = ts.transpileModule(sourceText, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      resolveJsonModule: true,
    },
    fileName: sourceFile,
  });

  await writeFile(outFile, rewriteSpecifiers(transpiled.outputText, outFile), "utf8");
}

async function main() {
  await rm(outRoot, { recursive: true, force: true });
  await mkdir(outRoot, { recursive: true });

  try {

  const candidates = await listFiles(path.join(projectRoot, "src"));
  const tests = await listFiles(path.join(projectRoot, "tests"));
  const allFiles = [...candidates, ...tests].filter(shouldCompile);

  for (const file of allFiles) {
    await emitFile(file);
  }

  const compiledTests = tests
    .filter((file) => file.endsWith(".test.ts"))
    .map((file) => path.join(outRoot, path.relative(projectRoot, file)).replace(/\.ts$/, ".js"));

  for (const file of compiledTests) {
    requireFromRoot(file);
  }

    const runtime = requireFromRoot(path.join(outRoot, "tests", "vitest-lite.js"));
    await runtime.runRegisteredTests();
  } finally {
    await rm(outRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});