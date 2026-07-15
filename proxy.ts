import { NextRequest, NextResponse } from "next/server"
import { getSessionCookie } from "better-auth/cookies"

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const sessionCookie = getSessionCookie(request)

  if (pathname.startsWith("/admin") && !sessionCookie) {
    const url = new URL("/sign-in", request.url)
    url.searchParams.set("next", pathname)
    return NextResponse.redirect(url)
  }

  if (
    sessionCookie &&
    (pathname === "/sign-in" || pathname === "/sign-up")
  ) {
    return NextResponse.redirect(new URL("/", request.url))
  }

  if (pathname.startsWith("/favorites") && !sessionCookie) {
    const url = new URL("/sign-in", request.url)
    url.searchParams.set("next", pathname)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/admin/:path*", "/sign-in", "/sign-up", "/favorites/:path*"],
}
