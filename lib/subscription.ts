import { SignJWT, jwtVerify } from "jose";

export const SUB_COOKIE_NAME = "authswap_sub";

function getSecretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("Missing AUTH_SECRET env var");
  return new TextEncoder().encode(secret);
}

export async function createSubToken(params: { wallet: string; paidUntilMs: number }) {
  const key = getSecretKey();
  return await new SignJWT({ wallet: params.wallet, paidUntilMs: params.paidUntilMs })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("90d")
    .sign(key);
}

export async function readSubToken(token: string) {
  const key = getSecretKey();
  const { payload } = await jwtVerify(token, key);
  const wallet = payload.wallet;
  const paidUntilMs = payload.paidUntilMs;

  if (typeof wallet !== "string") return null;
  if (typeof paidUntilMs !== "number") return null;

  return { wallet, paidUntilMs };
}

export function subCookie(token: string) {
  return `${SUB_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=7776000`;
}

export function clearSubCookie() {
  return `${SUB_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
