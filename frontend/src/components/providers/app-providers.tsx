"use client"

import { useState } from "react"
import { useEffect } from "react"
import { useRouter } from "next/navigation"
import axios from "axios"
import {
  QueryClient,
  QueryClientProvider,
  type QueryClientConfig,
} from "@tanstack/react-query"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"

import { TooltipProvider } from "@/components/ui/tooltip"
import { refreshAccessToken, getAccessToken, decodeJwt, setAccessToken } from "@/lib/api-client"
import { Toaster } from "@/components/ui/sonner"

type AppProvidersProps = {
  children: React.ReactNode
}

const queryClientConfig: QueryClientConfig = {
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
}

export function AppProviders({ children }: AppProvidersProps) {
  const [queryClient] = useState(() => new QueryClient(queryClientConfig))
  const router = useRouter()
  useEffect(() => {
    let timer: number | undefined

    async function attemptRefresh() {
      try {
        await refreshAccessToken()
        scheduleRefresh()
        return
      } catch (err: unknown) {
        // on unauthorized, clear token and send to login
        setAccessToken(null)
        const status = axios.isAxiosError(err) ? err.response?.status : undefined
        if (status === 401) {
          // If we're on the client, preserve any existing `from` query
          // (middleware may have added it). If we're not on the signin
          // page already, include a `from` param so the user returns
          // to their original path after signing in.
          if (typeof window !== "undefined") {
            const { pathname, search } = window.location
            if (pathname.startsWith("/signin")) {
              router.replace(`/signin${search}`)
            } else {
              const from = encodeURIComponent(pathname + search)
              router.replace(`/signin?from=${from}`)
            }
          } else {
            router.replace("/signin")
          }
        }
        // don't schedule refresh
        return
      }
    }

    function scheduleRefresh() {
      const token = getAccessToken()
      if (!token) return
      const payload = decodeJwt(token) as { exp?: number } | null
      if (!payload || !payload.exp) return
      const msUntilExpiry = payload.exp * 1000 - Date.now()
      const refreshBefore = 30_000 // 30s before expiry
      const delay = Math.max(10_000, msUntilExpiry - refreshBefore)
      timer = window.setTimeout(async () => {
        try {
          await refreshAccessToken()
        } catch {
          // swallow
        }
        scheduleRefresh()
      }, delay)
    }

    attemptRefresh()

    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [router])

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {children}
        <Toaster />
      </TooltipProvider>
      {/* <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" /> */}
    </QueryClientProvider>
  )
}
