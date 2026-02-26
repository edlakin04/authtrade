import { SignJWT, jwtVerify } from "jose";
import bs58 from "bs58";
import nacl from "tweetnacl";

const COOKIE_NAME = "authswap_session";

function getSecretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("Missing AUTH_SECRET env var");
  return new TextEncoder().encode(secret);
}

export function makeNonce() {
  // simple + safe enough for nonce
  return crypto.randomUUID();
}

export function buildLoginMessage(nonce: string) {
  return `Authswap Login

Sign this message to prove you own this wallet.
This does NOT approve any transactions.

Nonce: ${nonce}`;
}

export function verifySolanaSignature(params: {
  publicKeyBase58: string;
  signatureBase58: string;
  message: string;
}) {
  const publicKeyBytes = bs58.decode(params.publicKeyBase58);
  const signatureBytes = bs58.decode(params.signatureBase58);
  const messageBytes = new TextEncoder().encode(params.message);

  return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
}

export async function createSessionToken(wallet: string) {
  const key = getSecretKey();
  return await new SignJWT({ wallet })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key);
}

export async function readSessionToken(token: string) {
  const key = getSecretKey();
  const { payload } = await jwtVerify(token, key);
  const wallet = payload.wallet;
  if (typeof wallet !== "string") return null;
  return { wallet };
}

export function sessionCookie(token: string) {
  // httpOnly so JS can’t steal it, secure so only https, lax for normal nav
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
