function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const part = jwt.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function parseUserIdFromJwt(jwt: string): string | null {
  const payload = decodeJwtPayload(jwt);
  if (!payload) return null;
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  if (!sub) return null;
  const parts = sub.split("|");
  return parts.length > 1 ? parts[1]! : sub;
}
