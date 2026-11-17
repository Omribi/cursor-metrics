import { describe, expect, it } from "bun:test";
import { parseUserIdFromJwt } from "../src/jwt";

function jwtWithSub(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ sub })).toString("base64url");
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}

describe("parseUserIdFromJwt", () => {
  it("reads the id after the provider prefix", () => {
    expect(parseUserIdFromJwt(jwtWithSub("auth0|user_01ABC"))).toBe("user_01ABC");
  });

  it("returns null for a sealed non-JWT string", () => {
    expect(parseUserIdFromJwt("cursor-safe-storage:v1:djEw")).toBeNull();
  });
});
