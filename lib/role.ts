import { SignJWT, jwtVerify } from "jose";

export const ROLE_COOKIE_NAME = "authswap_role";

function getSecretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("Missing AUTH_SECRET env var");
  return new TextEncoder().encode(secret);
}

export async function createRoleToken(params: { wallet: string; role: "user" | "dev" | "admin" }) {
  const key = getSecretKey();
  return await new SignJWT({ wallet: params.wallet, role: params.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(key);
}

export async function readRoleToken(token: string) {
  const key = getSecretKey();
  const { payload } = await jwtVerify(token, key);

  const wallet = payload.wallet;
  const role = payload.role;

  if (typeof wallet !== "string") return null;
  if (role !== "user" && role !== "dev" && role !== "admin") return null;

  return { wallet, role };
}

export function roleCookie(token: string) {
  return `${ROLE_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;
}

export function clearRoleCookie() {
  return `${ROLE_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
