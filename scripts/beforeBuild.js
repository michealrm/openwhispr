#!/usr/bin/env node
/**
 * electron-builder beforeBuild hook.
 *
 * Disables native rebuild of @sentry-internal/node-cpu-profiler by temporarily
 * removing its binding.gyp.  The profiler is an optional Sentry perf addon that
 * comes in transitively through @neondatabase/neon-js and is not imported by the
 * app at runtime.  Without Python + arm64 cross-compiler it cannot be built for
 * non-host architectures.
 */

const fs = require("fs");
const path = require("path");

module.exports = async function beforeBuild(context) {
  const profilerRoot = path.join(
    context.appDir,
    "node_modules",
    "@sentry-internal",
    "node-cpu-profiler"
  );
  const gypFile = path.join(profilerRoot, "binding.gyp");
  const gypBak = gypFile + ".bak";

  if (fs.existsSync(gypFile) && !fs.existsSync(gypBak)) {
    fs.renameSync(gypFile, gypBak);
    console.log(
      "[beforeBuild] Disabled @sentry-internal/node-cpu-profiler native rebuild (not used at runtime)"
    );
  }
};
