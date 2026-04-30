/* eslint-disable @typescript-eslint/no-require-imports */
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

const originalExec = childProcess.exec;

childProcess.exec = function patchedExec(command, options, callback) {
  let resolvedOptions = options;
  let resolvedCallback = callback;

  if (typeof options === "function") {
    resolvedCallback = options;
    resolvedOptions = undefined;
  }

  const normalizedCommand = typeof command === "string" ? command.trim().toLowerCase() : "";
  if (normalizedCommand === "net use") {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    process.nextTick(() => {
      child.stdout.end("");
      child.stderr.end("");
      if (typeof resolvedCallback === "function") {
        resolvedCallback(null, "", "");
      }
      child.emit("close", 0);
      child.emit("exit", 0);
    });
    return child;
  }

  return originalExec.call(this, command, resolvedOptions, resolvedCallback);
};