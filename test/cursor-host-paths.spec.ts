import { describe, expect, it } from "bun:test";
import { existsSync } from "fs";
import {
  cursorLocalStatePath,
  cursorStateDbPath,
  isWsl,
  liveCursorHost,
  usesWindowsOsCrypt,
} from "../src/cursor-host-paths";

describe("cursor host paths", () => {
  it("detects WSL from WSL_DISTRO_NAME", () => {
    expect(isWsl("Ubuntu")).toBe(true);
    expect(isWsl("")).toBe(false);
  });

  it("uses Windows OSCrypt on native Windows and on WSL", () => {
    expect(usesWindowsOsCrypt({ platform: "win32", home: "C:\\Users\\ada" })).toBe(true);
    expect(
      usesWindowsOsCrypt({ platform: "linux", home: "/home/ada", wslDistroName: "Ubuntu" }),
    ).toBe(true);
    expect(usesWindowsOsCrypt({ platform: "linux", home: "/home/ada", wslDistroName: "" })).toBe(false);
    expect(usesWindowsOsCrypt({ platform: "darwin", home: "/Users/ada" })).toBe(false);
  });

  it("points at the Windows Cursor DB and Local State when running in WSL", () => {
    const host = {
      platform: "linux" as const,
      home: "/home/ada",
      wslDistroName: "Ubuntu",
      resolveWslWindowsUserProfile: () => "/mnt/c/Users/ada",
    };

    expect(cursorStateDbPath(host)).toBe(
      "/mnt/c/Users/ada/AppData/Roaming/Cursor/User/globalStorage/state.vscdb",
    );
    expect(cursorLocalStatePath(host)).toBe("/mnt/c/Users/ada/AppData/Roaming/Cursor/Local State");
  });

  it("falls back to the Linux Cursor path when WSL profile resolution fails", () => {
    const host = {
      platform: "linux" as const,
      home: "/home/ada",
      wslDistroName: "Ubuntu",
      resolveWslWindowsUserProfile: () => {
        throw new Error("cmd.exe missing");
      },
    };

    expect(cursorStateDbPath(host)).toBe("/home/ada/.config/Cursor/User/globalStorage/state.vscdb");
  });

  it("keeps native platform paths unchanged", () => {
    expect(
      cursorStateDbPath({ platform: "darwin", home: "/Users/ada" }),
    ).toBe("/Users/ada/Library/Application Support/Cursor/User/globalStorage/state.vscdb");
    expect(
      cursorStateDbPath({
        platform: "win32",
        home: "C:\\Users\\ada",
        appData: "C:\\Users\\ada\\AppData\\Roaming",
      }),
    ).toBe("C:\\Users\\ada\\AppData\\Roaming/Cursor/User/globalStorage/state.vscdb");
    expect(
      cursorStateDbPath({ platform: "linux", home: "/home/ada", wslDistroName: "" }),
    ).toBe("/home/ada/.config/Cursor/User/globalStorage/state.vscdb");
  });
});

describe("live WSL host", () => {
  it("resolves the Windows Cursor database when this process is in WSL", () => {
    if (!process.env.WSL_DISTRO_NAME) return;

    const dbPath = cursorStateDbPath(liveCursorHost());
    expect(dbPath.includes("AppData/Roaming/Cursor/User/globalStorage/state.vscdb")).toBe(true);
    expect(existsSync(dbPath)).toBe(true);
    expect(existsSync(cursorLocalStatePath(liveCursorHost()))).toBe(true);
  });
});
