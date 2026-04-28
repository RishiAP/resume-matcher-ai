import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

// Proxy for Next 16: verify httpOnly refresh cookie with backend for
// every app route except explicit public pages (login, not-found) and
// Next internals/static assets.

const BACKEND_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Public routes that should never require auth (served to everyone).
  // Keep this list minimal and explicit so middleware checks are fast.
  const PUBLIC_PATHS = new Set([
    "/signin",
    "/manifest.webmanifest",
    "/manifest.json",
    "/favicon.ico",
    "/favicon-16x16.png",
    "/favicon-32x32.png",
    "/apple-touch-icon.png",
    "/android-chrome-192x192.png",
    "/android-chrome-512x512.png",
    "/NextICron-logo.png",
    "/NextICron-logo-white.png",
    "/robots.txt",
    "/sitemap.xml",
    "/_not-found",
    "/404",
  ])

  // Fast-path for obvious public files (icons, manifest, root, signin)
  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next()
  }

  // Forward cookie header to backend verify endpoint so it can read httpOnly cookie
  const cookieHeader = request.headers.get("cookie") || ""

  // Special-case signin: allow unauthenticated users to load the page,
  // but if the refresh cookie verifies, redirect them to `from` or dashboard.
  if (pathname === "/signin" || pathname === "/signin/") {
    try {
      const verifyRes = await fetch(`${BACKEND_BASE}/api/auth/verify`, {
        method: "GET",
        headers: { cookie: cookieHeader },
        cache: "no-store",
      })

      if (verifyRes.ok) {
        const from = request.nextUrl.searchParams.get("from") || "/dashboard"
        return NextResponse.redirect(new URL(from, request.url))
      }
      return NextResponse.next()
    } catch {
      return NextResponse.next()
    }
  }

  // Protect all other app routes: verify and allow, otherwise redirect to signin
  try {
    const verifyRes = await fetch(`${BACKEND_BASE}/api/auth/verify`, {
      method: "GET",
      headers: { cookie: cookieHeader },
      cache: "no-store",
    })

    if (verifyRes.ok) {
      return NextResponse.next()
    }
  } catch {
    // treat as unauthenticated on error
  }

  const signinUrl = new URL("/signin", request.url)
  signinUrl.searchParams.set("from", pathname)
  return NextResponse.redirect(signinUrl)
}

export const config = {
  // Run this proxy for all routes except Next internals/static assets
  // and the public login/not-found pages. The matcher uses a negative
  // lookahead so it only matches protected paths. We keep the matcher
  // broad (exclude `_next` and `api`) and perform the fine-grained
  // public whitelist inside the middleware for clarity and speed.
  matcher: ['/((?!_next|api|static).*)'],
}
