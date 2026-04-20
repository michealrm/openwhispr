#!/usr/bin/env node
/**
 * Builds OpenWhispr for Windows ARM64.
 *
 * Three build-blocker issues are handled here so the production electron-builder.json
 * remains unmodified:
 *
 * 1. @sentry-internal/node-cpu-profiler — pulled in transitively by @neondatabase/neon-js,
 *    requires Python + an ARM64 C++ cross-compiler.  It is NOT used at runtime, so we
 *    temporarily rename its binding.gyp to skip node-gyp rebuild.
 *
 * 2. Code signing — the production config includes azureSignOptions for CI.  Without Azure
 *    credentials and no signtoolOptions, electron-builder skips signing entirely (no cert
 *    → signFile returns false early).
 *
 * 3. winCodeSign legacy 7z extraction — the Go app-builder binary downloads
 *    winCodeSign-2.6.0.7z and extracts it with -snl (create symlinks).  On Windows
 *    without Developer Mode, symlink creation fails and 7-zip exits with code 2, which
 *    the Go binary treats as a fatal error.  The needed files (rcedit-x64.exe,
 *    signtool.exe) are always extracted before any symlink error.
 *
 *    Fix: patch builder-util/out/util.js to set SZA_PATH to scripts/7za-wrap.exe, a
 *    thin wrapper that calls the real 7za.exe and converts exit code 2 → 0.  The wrapper
 *    reads REAL_7ZA_PATH for the actual 7za path.
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// 1. Sentry profiler binding.gyp bypass
// ---------------------------------------------------------------------------

const profilerDir = path.join(root, "node_modules", "@sentry-internal", "node-cpu-profiler");
const gypFile = path.join(profilerDir, "binding.gyp");
const gypBak = gypFile + ".disabled";
let profilerDisabled = false;

function disableProfiler() {
  if (fs.existsSync(gypFile) && !fs.existsSync(gypBak)) {
    fs.renameSync(gypFile, gypBak);
    profilerDisabled = true;
    console.log(
      "[build-win-arm64] Temporarily disabled @sentry-internal/node-cpu-profiler native rebuild"
    );
  }
}

function restoreProfiler() {
  if (profilerDisabled && fs.existsSync(gypBak)) {
    fs.renameSync(gypBak, gypFile);
    console.log("[build-win-arm64] Restored @sentry-internal/node-cpu-profiler/binding.gyp");
  }
}

// ---------------------------------------------------------------------------
// 2. Temporary signing-disabled config
// ---------------------------------------------------------------------------

const baseConfigPath = path.join(root, "electron-builder.json");
const tmpConfigPath = path.join(root, "electron-builder-arm64-local.json");

function writeLocalConfig() {
  const config = JSON.parse(fs.readFileSync(baseConfigPath, "utf8"));

  // Remove Azure Trusted Signing — not available without CI credentials.
  // With no cert and no azureSignOptions, electron-builder skips signing entirely.
  if (config.win) {
    delete config.win.azureSignOptions;
    delete config.win.signtoolOptions;
  }

  fs.writeFileSync(tmpConfigPath, JSON.stringify(config, null, 2));
  console.log("[build-win-arm64] Wrote temporary unsigned config:", tmpConfigPath);
  return tmpConfigPath;
}

function cleanLocalConfig() {
  if (fs.existsSync(tmpConfigPath)) {
    fs.unlinkSync(tmpConfigPath);
    console.log("[build-win-arm64] Removed temporary config");
  }
}

// ---------------------------------------------------------------------------
// 3. Patch builder-util/out/util.js to route SZA_PATH through 7za-wrap.exe
//
// The Go app-builder binary reads the SZA_PATH env var to find 7zip.
// We redirect it to our wrapper which converts 7zip exit code 2 → 0, allowing
// the Go binary to proceed despite the missing macOS dylib symlinks.
// ---------------------------------------------------------------------------

const utilJsPath = path.join(root, "node_modules", "builder-util", "out", "util.js");
let originalUtilJs = null;

const UTIL_PATCH_MARKER = "// [build-win-arm64 sza-wrap patch]";
// The exact string that sets SZA_PATH in executeAppBuilder
const UTIL_PATCH_TARGET = `SZA_PATH: await (0, _7za_1.getPath7za)(),`;
const UTIL_PATCH_REPLACEMENT = `SZA_PATH: process.env.WRAP_7ZA_PATH || await (0, _7za_1.getPath7za)(), ${UTIL_PATCH_MARKER}`;

function patchUtilJs() {
  if (!fs.existsSync(utilJsPath)) {
    console.warn("[build-win-arm64] WARNING: builder-util/out/util.js not found — skipping SZA_PATH patch");
    return;
  }
  const original = fs.readFileSync(utilJsPath, "utf8");
  if (original.includes(UTIL_PATCH_MARKER)) return; // already patched
  originalUtilJs = original;
  const patched = original.replace(UTIL_PATCH_TARGET, UTIL_PATCH_REPLACEMENT);
  if (patched === original) {
    console.warn("[build-win-arm64] WARNING: could not find SZA_PATH target in util.js — symlink errors may abort build");
    originalUtilJs = null;
    return;
  }
  fs.writeFileSync(utilJsPath, patched);
  console.log("[build-win-arm64] Patched builder-util/out/util.js to use 7za-wrap.exe");
}

function restoreUtilJs() {
  if (originalUtilJs !== null) {
    fs.writeFileSync(utilJsPath, originalUtilJs);
    originalUtilJs = null;
    console.log("[build-win-arm64] Restored builder-util/out/util.js");
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  disableProfiler();
  writeLocalConfig();

  const wrapExe = path.join(root, "scripts", "7za-wrap.exe");
  const real7za = path.join(root, "node_modules", "7zip-bin", "win", "x64", "7za.exe");

  if (process.platform === "win32" && fs.existsSync(wrapExe) && fs.existsSync(real7za)) {
    patchUtilJs();
    console.log("[build-win-arm64] 7za wrapper active:", wrapExe);
  } else if (process.platform === "win32") {
    console.warn("[build-win-arm64] WARNING: 7za-wrap.exe not found — build may fail on symlink extraction");
    console.warn("  Run: node scripts/compile-7za-wrap-helper.js");
  }

  try {
    const ebBin =
      process.platform === "win32"
        ? path.join(root, "node_modules", ".bin", "electron-builder.cmd")
        : path.join(root, "node_modules", ".bin", "electron-builder");

    const result = spawnSync(
      ebBin,
      ["--win", "--arm64", `--config=${path.basename(tmpConfigPath)}`],
      {
        stdio: "inherit",
        cwd: root,
        env: {
          ...process.env,
          CSC_IDENTITY_AUTO_DISCOVERY: "false",
          WIN_CSC_LINK: "",
          // 7za wrapper env vars (no-op on non-Windows or if wrapper not compiled)
          ...(process.platform === "win32" && fs.existsSync(wrapExe) && fs.existsSync(real7za)
            ? { WRAP_7ZA_PATH: wrapExe, REAL_7ZA_PATH: real7za }
            : {}),
        },
        shell: process.platform === "win32",
      }
    );

    process.exitCode = result.status ?? 1;
  } finally {
    restoreProfiler();
    cleanLocalConfig();
    restoreUtilJs();
  }
}

main().catch((err) => {
  console.error(err);
  restoreProfiler();
  cleanLocalConfig();
  restoreUtilJs();
  process.exit(1);
});
