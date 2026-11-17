import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

const INTEROP_TIMEOUT_MS = 10_000;

export type CursorHostPaths = {
  platform: NodeJS.Platform;
  home: string;
  appData?: string;
  wslDistroName?: string;
  resolveWslWindowsUserProfile?: () => string;
  onWslProfileError?: (error: unknown) => void;
};

let cachedWindowsProfile: string | undefined;

export function isWsl(wslDistroName = process.env.WSL_DISTRO_NAME): boolean {
  return Boolean(wslDistroName);
}

export function liveCursorHost(): CursorHostPaths {
  return {
    platform: process.platform,
    home: homedir(),
    appData: process.env.APPDATA,
    wslDistroName: process.env.WSL_DISTRO_NAME,
  };
}

export function usesWindowsOsCrypt(host: CursorHostPaths = liveCursorHost()): boolean {
  return host.platform === "win32" || (host.platform === "linux" && isWsl(host.wslDistroName));
}

export function cursorRoamingDir(host: CursorHostPaths = liveCursorHost()): string {
  if (host.platform === "darwin") {
    return join(host.home, "Library/Application Support");
  }
  if (host.platform === "win32") {
    return host.appData ?? join(host.home, "AppData/Roaming");
  }
  if (isWsl(host.wslDistroName)) {
    try {
      const resolve = host.resolveWslWindowsUserProfile ?? resolveWslWindowsUserProfile;
      return join(resolve(), "AppData/Roaming");
    } catch (error) {
      host.onWslProfileError?.(error);
    }
  }
  return join(host.home, ".config");
}

export function cursorStateDbPath(host: CursorHostPaths = liveCursorHost()): string {
  return join(cursorRoamingDir(host), "Cursor/User/globalStorage/state.vscdb");
}

export function cursorLocalStatePath(host: CursorHostPaths = liveCursorHost()): string {
  return join(cursorRoamingDir(host), "Cursor/Local State");
}

export function windowsInteropCwd(): string | undefined {
  if (process.platform === "win32") return undefined;
  for (const candidate of ["/mnt/c/Windows", "/mnt/c/WINDOWS"]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export function resolveWindowsPowershell(): string {
  if (process.platform === "win32") return "powershell.exe";

  const cmd = resolveWindowsCmd();
  if (cmd !== "cmd.exe") {
    const sibling = join(dirname(cmd), "WindowsPowerShell/v1.0/powershell.exe");
    if (existsSync(sibling)) return sibling;
  }

  for (const candidate of [
    "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
    "/mnt/c/WINDOWS/System32/WindowsPowerShell/v1.0/powershell.exe",
    "/mnt/c/WINDOWS/system32/WindowsPowerShell/v1.0/powershell.exe",
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return "powershell.exe";
}

export function resolveWslWindowsUserProfile(): string {
  if (cachedWindowsProfile) return cachedWindowsProfile;

  const winPath = parseWindowsUserProfile(
    execFileSync(resolveWindowsCmd(), ["/c", "echo %USERPROFILE%"], {
      encoding: "utf8",
      timeout: INTEROP_TIMEOUT_MS,
      cwd: windowsInteropCwd(),
      windowsHide: true,
    }),
  );
  const unixPath = execFileSync("wslpath", ["-u", winPath], {
    encoding: "utf8",
    timeout: INTEROP_TIMEOUT_MS,
  }).trim();
  if (!unixPath) throw new Error("wslpath returned an empty path");
  cachedWindowsProfile = unixPath;
  return unixPath;
}

function resolveWindowsCmd(): string {
  for (const candidate of [
    "/mnt/c/WINDOWS/system32/cmd.exe",
    "/mnt/c/Windows/System32/cmd.exe",
    "/mnt/c/WINDOWS/System32/cmd.exe",
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return "cmd.exe";
}

function parseWindowsUserProfile(stdout: string): string {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line && /^[A-Za-z]:[\\/]/.test(line)) return line;
  }
  throw new Error("Could not resolve Windows USERPROFILE");
}
