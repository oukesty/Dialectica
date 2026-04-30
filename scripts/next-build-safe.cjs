/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("node:fs");
const path = require("node:path");

const tsconfigPath = path.join(process.cwd(), "tsconfig.json");
const originalTsconfig = fs.existsSync(tsconfigPath) ? fs.readFileSync(tsconfigPath, "utf8") : null;

function restoreTsconfig() {
  if (originalTsconfig === null || !fs.existsSync(tsconfigPath)) {
    return;
  }

  const currentTsconfig = fs.readFileSync(tsconfigPath, "utf8");
  if (currentTsconfig !== originalTsconfig) {
    fs.writeFileSync(tsconfigPath, originalTsconfig, "utf8");
  }
}

process.on("exit", restoreTsconfig);
process.on("SIGINT", () => {
  restoreTsconfig();
  process.exit(130);
});
process.on("SIGTERM", () => {
  restoreTsconfig();
  process.exit(143);
});

class InProcessWorker {
  constructor(workerModulePath, options = {}) {
    this.workerModulePath = workerModulePath;
    this.options = options;
    this.moduleExports = require(workerModulePath);
    this.queue = Promise.resolve();
    this._onActivity = options.onActivity;
    this._onActivityAbort = options.onActivityAbort;

    for (const method of options.exposedMethods || []) {
      if (method.startsWith('_')) {
        continue;
      }

      const implementation = this.moduleExports[method];
      if (typeof implementation !== 'function') {
        throw new Error(
          'In-process Next worker could not find method "' + method + '" in ' + workerModulePath,
        );
      }

      this[method] = (...args) => {
        const run = async () => {
          this._onActivity?.();
          return await this.runWithWorkerEnv(implementation, args);
        };

        const result = this.queue.then(run, run);
        this.queue = result.catch(() => undefined);
        return result.finally(() => {
          this._onActivityAbort?.();
        });
      };
    }
  }

  setOnActivity(onActivity) {
    this._onActivity = onActivity;
  }

  setOnActivityAbort(onActivityAbort) {
    this._onActivityAbort = onActivityAbort;
  }

  async runWithWorkerEnv(implementation, args) {
    const envUpdates = {
      IS_NEXT_WORKER: 'true',
      ...(this.options.forkOptions?.env || {}),
    };
    const previousEnv = new Map();

    for (const [key, value] of Object.entries(envUpdates)) {
      previousEnv.set(key, process.env[key]);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = String(value);
      }
    }

    try {
      return await implementation(...args);
    } finally {
      for (const [key, value] of previousEnv.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  }

  async end() {}

  close() {}
}

const workerModuleId = require.resolve('next/dist/lib/worker');
require.cache[workerModuleId] = {
  id: workerModuleId,
  filename: workerModuleId,
  loaded: true,
  exports: {
    Worker: InProcessWorker,
    getNextBuildDebuggerPortOffset: () => 0,
  },
};

process.argv = [
  process.execPath,
  require.resolve('next/dist/bin/next'),
  'build',
  '--webpack',
];

require('next/dist/bin/next');
