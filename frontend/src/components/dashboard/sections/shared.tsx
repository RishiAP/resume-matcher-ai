"use client"

import { useCallback, useEffect, useState } from "react"
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  Loader2Icon,
  XIcon,
} from "lucide-react"

import type { QueueJobsStatus } from "@/lib/api-client"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export type ToastState = {
  type: "success" | "error"
  title: string
  message: string
}

export const acceptedResumeExtensions = [".pdf", ".doc", ".docx"]

export const healthQueryKey = ["health"] as const
export const jobsQueryKey = ["resume-jobs"] as const
export const requirementsQueryKey = ["requirements"] as const

export const isValidHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

export const hasSupportedResumeExtension = (fileName: string): boolean => {
  const lowerFileName = fileName.toLowerCase()
  return acceptedResumeExtensions.some((extension) =>
    lowerFileName.endsWith(extension)
  )
}

export const parseResumeUrls = (rawValue: string): string[] =>
  rawValue
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)

export const toOptionalInt = (value?: string): number | undefined => {
  if (!value?.trim()) {
    return undefined
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed)) {
    return undefined
  }

  return parsed
}

export const toOptionalFloat = (value?: string): number | undefined => {
  if (!value?.trim()) {
    return undefined
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return undefined
  }

  return parsed
}

export const toScorePercent = (score: number): number => {
  return score <= 1 ? Math.round(score * 100) : Math.round(score)
}

export function MutationState({
  isLoading,
  pendingLabel,
  idleLabel,
}: {
  isLoading: boolean
  pendingLabel: string
  idleLabel: string
}) {
  if (isLoading) {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" />
        {pendingLabel}
      </span>
    )
  }

  return <span className="text-sm text-muted-foreground">{idleLabel}</span>
}

export function Notification({
  state,
  onDismiss,
  autoDismissMs = 5000,
}: {
  state: ToastState | null
  onDismiss?: () => void
  autoDismissMs?: number
}) {
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)
  const notificationKey = state
    ? `${state.type}:${state.title}:${state.message}`
    : null
  const dismissed = Boolean(notificationKey && dismissedKey === notificationKey)

  const dismissNotification = useCallback(() => {
    if (onDismiss) {
      onDismiss()
      return
    }

    if (notificationKey) {
      setDismissedKey(notificationKey)
    }
  }, [notificationKey, onDismiss])

  useEffect(() => {
    if (!state || dismissed || autoDismissMs <= 0) {
      return
    }

    const timer = window.setTimeout(() => {
      dismissNotification()
    }, autoDismissMs)

    return () => {
      window.clearTimeout(timer)
    }
  }, [autoDismissMs, dismissNotification, dismissed, state, notificationKey])

  if (!state) {
    return null
  }

  if (dismissed) {
    return null
  }

  const icon =
    state.type === "success" ? (
      <CheckCircle2Icon className="size-4" />
    ) : (
      <AlertCircleIcon className="size-4" />
    )

  return (
    <Alert variant={state.type === "error" ? "destructive" : "default"}>
      {icon}
      <AlertTitle>{state.title}</AlertTitle>
      <AlertDescription>{state.message}</AlertDescription>
      <AlertAction>
        <button
          type="button"
          onClick={dismissNotification}
          className="inline-flex size-7 items-center justify-center rounded-md border border-border/70 bg-background/70 text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
          aria-label="Dismiss notification"
        >
          <XIcon className="size-4" />
        </button>
      </AlertAction>
    </Alert>
  )
}

export function QueueStatusBanner({ jobs }: { jobs: QueueJobsStatus | undefined }) {
  if (!jobs) {
    return null
  }

  return (
    <div className="rounded-lg border border-border/70 bg-card/80 p-3 shadow-xs">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Queue Snapshot
        </p>
        <p className="text-xs text-muted-foreground">Live</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge className="border border-primary/20 bg-primary/10 text-primary hover:bg-primary/10">
          Running {jobs.running}
        </Badge>
        <Badge variant="outline" className="border-border/80 bg-card/60">
          Queued {jobs.queued}
        </Badge>
        <Badge variant="outline" className="border-border/80 bg-card/60">
          Workers {jobs.workers_online}
        </Badge>
      </div>
    </div>
  )
}

export function SkillsPreview({
  skills,
  keyPrefix,
}: {
  skills: string[] | null | undefined
  keyPrefix: string
}) {
  const normalizedSkills =
    skills
      ?.map((skill) => skill.trim())
      .filter(Boolean) ?? []

  if (!normalizedSkills.length) {
    return <span className="text-muted-foreground">-</span>
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="w-full cursor-help rounded-md border border-transparent text-left transition-colors hover:border-border/70 hover:bg-muted/20 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          aria-label={`Show all ${normalizedSkills.length} skills`}
        >
          <div className="flex max-w-[320px] flex-wrap gap-1">
            {normalizedSkills.slice(0, 3).map((skill) => (
              <Badge key={`${keyPrefix}-${skill}`} variant="secondary">
                {skill}
              </Badge>
            ))}
            {normalizedSkills.length > 3 && (
              <Badge variant="outline">+{normalizedSkills.length - 3}</Badge>
            )}
          </div>
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-md border border-border/80 bg-popover/95 text-popover-foreground shadow-xl [&>svg]:hidden">
        <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          All Skills ({normalizedSkills.length})
        </p>
        <div className="flex max-w-md flex-wrap gap-1">
          {normalizedSkills.map((skill) => (
            <Badge key={`${keyPrefix}-all-${skill}`} variant="outline">
              {skill}
            </Badge>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

export function formatMonthYear(dateStr: string | null | undefined): string {
  if (!dateStr) return "-"
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleString("default", { month: "short", year: "numeric" })
}

export function candidateDisplayValue(
  value: string | number | null | undefined,
  emptyFallback = "-",
  opts?: { monthYear?: boolean }
): string {
  if (opts?.monthYear && typeof value === "string") {
    return formatMonthYear(value)
  }
  if (value == null) {
    return emptyFallback
  }
  if (typeof value === "string") {
    const normalized = value.trim()
    return normalized.length ? normalized : emptyFallback
  }
  return String(value)
}
