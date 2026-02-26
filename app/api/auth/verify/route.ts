import { NextResponse } from "next/server";
import {
  buildLoginMessage,
  createSessionToken,
  sessionCookie,
  verifySolanaSignature
} from "@/lib/auth";
import { cookies } from "next/headers";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.publicKey || !body?.signature) {
    return NextResponse.json({ error: "Missing publicKey or signature" }, { status: 400 });
  }

  // Next.js 15: cookies() is async
  const cookieStore = await cookies();
  const nonceCookie = cookieStore.get("authswap_nonce")?.value;

  if (!nonceCookie) {
    return NextResponse.json({ error: "Missing nonce (refresh and try again)" }, { status: 400 });
  }

  const message = buildLoginMessage(nonceCookie);

  const ok = verifySolanaSignature({
    publicKeyBase58: body.publicKey,
    signatureBase58: body.signature,
    message
  });

  if (!ok) {
    return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
  }

  const token = await createSessionToken(body.publicKey);

  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", sessionCookie(token));
  res.headers.append(
    "Set-Cookie",
    `authswap_nonce=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
  );

  return res;
}
