import { PHASE_PRODUCTION_BUILD } from "next/constants";

/**
 * Next.js server startup hook: runs once when a Node.js server instance starts.
 * Fails fast with exit(1) if `NOVA_AUTH_SECRET` is missing, shorter than 32 chars,
 * or weak in production runtime — never blocking `next build`.
 */
export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD
  ) {
    try {
      const { assertProductionAuthSecret } = await import(
        "@/lib/security/authCrypto"
      );
      assertProductionAuthSecret();
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
}
