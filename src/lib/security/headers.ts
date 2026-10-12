// No "@/" imports here: next.config.ts imports this file directly.

/**
 * Sent with every response (see next.config.ts). The app is never meant to be
 * framed, so framing is refused in both the old and the CSP form; a full CSP is
 * left out because Next.js inline scripts would need nonces.
 */
export const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];
