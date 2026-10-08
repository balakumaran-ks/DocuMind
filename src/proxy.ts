import { auth } from "@/auth";
import { isProtectedPath } from "@/lib/auth/callbacks";

/**
 * Sends signed-out visitors from app pages back to the sign-in page. This is a
 * convenience, not the security boundary: pages and API routes check the
 * session themselves.
 */
export const proxy = auth((request) => {
  if (!request.auth?.user?.id && isProtectedPath(request.nextUrl.pathname)) {
    return Response.redirect(new URL("/", request.nextUrl));
  }
});

export const config = { matcher: ["/documents/:path*"] };
