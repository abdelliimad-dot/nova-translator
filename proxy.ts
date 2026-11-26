import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  AuthConfigurationError,
  CLIENT_SID_COOKIE,
  CLIENT_SID_TTL_MS,
  isHttpsRequest,
  issueClientSidToken,
  verifyClientSidTokenWithMeta,
} from "@/lib/security/authCrypto";

/**
 * Next.js 16 proxy convention: issues and slides a signed HttpOnly anonymous
 * client-session cookie (`nova_client_sid`) on page navigations. Also migrates
 * sessions verified with `NOVA_AUTH_SECRET_PREVIOUS` onto the active secret.
 */
export function proxy(request: NextRequest) {
  try {
    const existingCookie = request.cookies.get(CLIENT_SID_COOKIE)?.value;
    const verified = verifyClientSidTokenWithMeta(existingCookie);

    const response = NextResponse.next();

    const shouldIssue =
      !verified ||
      verified.usedPreviousKey ||
      verified.payload.exp - Date.now() < CLIENT_SID_TTL_MS / 2;

    if (shouldIssue) {
      const { token } = issueClientSidToken(CLIENT_SID_TTL_MS);
      response.cookies.set({
        name: CLIENT_SID_COOKIE,
        value: token,
        httpOnly: true,
        sameSite: "lax",
        secure: isHttpsRequest(request),
        path: "/",
        maxAge: Math.floor(CLIENT_SID_TTL_MS / 1000),
      });
    }

    return response;
  } catch (err) {
    if (err instanceof AuthConfigurationError) {
      console.error(err.message);
      return NextResponse.json(
        { error: "Server security configuration error." },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }
    throw err;
  }
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|vad/|icons/|.*\\.(?:png|jpg|jpeg|svg|webp|ico|onnx|wasm|mjs)$).*)",
  ],
};
