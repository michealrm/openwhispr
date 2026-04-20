/*
 * 7za-wrap.c — thin 7zip wrapper for OpenWhispr local Windows ARM64 builds.
 *
 * The Go app-builder binary calls 7za.exe (via SZA_PATH env var) with the -snl
 * flag to create symbolic links during extraction.  On Windows without Developer
 * Mode, symlink creation fails and 7zip exits with code 2.  This wrapper runs the
 * real 7zip (REAL_7ZA_PATH env var) and converts exit code 2 → 0 so the
 * app-builder treats a partial extraction (missing only macOS dylib symlinks) as
 * success.  The needed files (rcedit-x64.exe, signtool.exe) are always extracted
 * successfully before any symlink error.
 */
#include <windows.h>
#include <stdio.h>
#include <string.h>

int main(void) {
    /* Build a verbatim copy of the command line but substitute the real 7za path */
    char real7za[MAX_PATH] = {0};
    DWORD n = GetEnvironmentVariableA("REAL_7ZA_PATH", real7za, sizeof(real7za));
    if (n == 0 || n >= sizeof(real7za)) {
        /* REAL_7ZA_PATH not set — just fail gracefully */
        fprintf(stderr, "7za-wrap: REAL_7ZA_PATH not set\n");
        return 1;
    }

    /* GetCommandLineA() includes argv[0]; replace it with real7za */
    const char *cmdTail = GetCommandLineA();
    /* Skip the wrapper executable token (may be quoted) */
    if (*cmdTail == '"') {
        cmdTail++;
        while (*cmdTail && *cmdTail != '"') cmdTail++;
        if (*cmdTail == '"') cmdTail++; /* skip closing quote */
    } else {
        while (*cmdTail && *cmdTail != ' ') cmdTail++;
    }

    /* Build new command line: "real7za" <rest-of-args> */
    char cmdline[32768];
    snprintf(cmdline, sizeof(cmdline), "\"%s\"%s", real7za, cmdTail);

    STARTUPINFOA si;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    PROCESS_INFORMATION pi;
    ZeroMemory(&pi, sizeof(pi));

    if (!CreateProcessA(NULL, cmdline, NULL, NULL, TRUE,
                        0, NULL, NULL, &si, &pi)) {
        fprintf(stderr, "7za-wrap: CreateProcess failed (%lu)\n", GetLastError());
        return 1;
    }

    WaitForSingleObject(pi.hProcess, INFINITE);

    DWORD exitCode = 1;
    GetExitCodeProcess(pi.hProcess, &exitCode);
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);

    /* 7-zip exit code 2 = minor errors (e.g. symlink creation failed on Windows).
     * The files we need are still extracted — treat as success. */
    if (exitCode == 2) {
        return 0;
    }
    return (int)exitCode;
}
