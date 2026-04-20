#!/usr/bin/env node
// Helper script to compile 7za-wrap.c using MSVC
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const vcvarsall = "C:\\Program Files\\Microsoft Visual Studio\\18\\Community\\VC\\Auxiliary\\Build\\vcvarsall.bat";
const src = path.join(__dirname, "7za-wrap.c");
const out = path.join(__dirname, "7za-wrap.exe");

const lines = [
  "@echo off",
  `call "${vcvarsall}" x64`,
  "if errorlevel 1 exit /b 1",
  `cl /nologo /O1 "${src}" /Fe:"${out}" /link kernel32.lib`,
  "exit /b %ERRORLEVEL%",
].join("\r\n");

const batPath = path.join(os.tmpdir(), "compile-7za-wrap.bat");
fs.writeFileSync(batPath, lines);
console.log("Batch file written to:", batPath);

const result = spawnSync("cmd.exe", ["/c", batPath], {
  stdio: "inherit",
  encoding: "utf8",
});

if (result.error) {
  console.error("spawnSync error:", result.error);
  process.exit(1);
}

if (result.status !== 0) {
  console.error("Compilation failed with exit code:", result.status);
  process.exit(result.status);
}

if (fs.existsSync(out)) {
  console.log("Compiled successfully:", out);
} else {
  console.error("Output binary not found after compilation");
  process.exit(1);
}
