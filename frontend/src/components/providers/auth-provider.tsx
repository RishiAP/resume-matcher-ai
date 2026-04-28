"use client"

import React, { createContext, useCallback, useContext, useEffect, useState } from "react"
import { usePathname } from "next/navigation"

import type { ApiUser } from "@/lib/api-client"
import {
  login as apiLogin,
  logout as apiLogout,
  refreshAccessToken,
  getCurrentUser,
  setAccessToken as apiSetAccessToken,
  onAccessTokenChange,
  setTokenProvider,
  decodeJwt,
} from "@/lib/api-client"

type AuthContextType = {
  accessToken: string | null
  user: ApiUser | null
  isAuthReady: boolean
  login: (identifier: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [user, setUser] = useState<ApiUser | null>(null)
  const [isAuthReady, setIsAuthReady] = useState(false)
  // const router = useRouter()
  const pathname = usePathname()

  // Let api-client consult our token via provider first
  useEffect(() => {
    setTokenProvider(() => accessToken)
  }, [accessToken])

  // Sync if api-client sets token (login/refresh from other callers)
  useEffect(() => {
    const unsub = onAccessTokenChange((token) => {
      setAccessToken(token)
    })
    return () => unsub()
  }, [])

  const loadUser = useCallback(async () => {
    try {
      const u = await getCurrentUser()
      setUser(u)
    } catch {
      setUser(null)
    }
  }, [])

  // Initial attempt to refresh token on app startup
  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        const res = await refreshAccessToken()
        // refreshAccessToken calls apiClient.setAccessToken internally;
        // ensure local state reflects token immediately
        setAccessToken(res.access_token)
        await loadUser()
      } catch {
        setAccessToken(null)
        setUser(null)
      } finally {
        if (!cancelled) setIsAuthReady(true)
      }
    }

    init()

    return () => {
      cancelled = true
    }
  }, [loadUser])

  // Schedule refresh before token expiry
  useEffect(() => {
    if (!accessToken) return

    const payload = decodeJwt(accessToken) as { exp?: number } | null
    if (!payload || !payload.exp) return

    const msUntilExpiry = payload.exp * 1000 - Date.now()
    const refreshBefore = 30_000 // refresh 30s before expiry
    const delay = Math.max(10_000, msUntilExpiry - refreshBefore)

    const timer: number | undefined = window.setTimeout(async () => {
      try {
        const res = await refreshAccessToken()
        setAccessToken(res.access_token)
        await loadUser()
      } catch {
        setAccessToken(null)
        setUser(null)
      }
    }, delay)

    return () => {
      if (timer) window.clearTimeout(timer)
    }
  }, [accessToken, loadUser])

  const login = useCallback(
    async (identifier: string, password: string) => {
      const res = await apiLogin(identifier, password)
      // apiLogin also updates api-client internal token; mirror into state
      setAccessToken(res.access_token)
      await loadUser()
    },
    [loadUser]
  )

  const logout = useCallback(async () => {
    try {
      await apiLogout()
    } catch {
      // ignore
    }
    apiSetAccessToken(null)
    setAccessToken(null)
    setUser(null)
  }, [])

  const refresh = useCallback(async () => {
    const res = await refreshAccessToken()
    setAccessToken(res.access_token)
    await loadUser()
  }, [loadUser])

  // Always create the context value so hooks order remains stable.
  const value = { accessToken, user, isAuthReady, login, logout, refresh }

  // While initializing, don't allow protected client-side navigation to
  // redirect prematurely. Allow public signin page to render.
  const inner = !isAuthReady && typeof pathname === "string" && !pathname.startsWith("/signin") ? (
    <div className="min-h-screen flex items-center justify-center p-4">Loading…</div>
  ) : (
    children
  )

  return <AuthContext.Provider value={value}>{inner}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider")
  return ctx
}
