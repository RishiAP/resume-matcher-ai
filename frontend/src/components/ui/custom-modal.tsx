"use client"

import type { ReactNode } from "react"
import { useEffect, useId } from "react"
import { XIcon } from "lucide-react"
import { createPortal } from "react-dom"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type CustomModalSize = "sm" | "md" | "lg" | "xl"

const sizeClassMap: Record<CustomModalSize, string> = {
  sm: "max-w-lg",
  md: "max-w-2xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
}

type CustomModalProps = {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: CustomModalSize
  className?: string
}

export function CustomModal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  size = "lg",
  className,
}: CustomModalProps) {
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    if (!open) {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose()
      }
    }

    window.addEventListener("keydown", handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [onClose, open])

  if (!open || typeof document === "undefined") {
    return null
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8 sm:px-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        aria-label="Close modal"
        onClick={onClose}
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          "animate-in fade-in zoom-in-95 relative z-10 flex max-h-[92vh] w-full flex-col overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl duration-150",
          sizeClassMap[size],
          className
        )}
        onClick={(event) => {
          event.stopPropagation()
        }}
      >
        <header className="border-b border-border/70 bg-muted/30 px-5 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h2 id={titleId} className="text-base font-semibold sm:text-lg">
                {title}
              </h2>
              {description ? (
                <p id={descriptionId} className="text-sm text-muted-foreground">
                  {description}
                </p>
              ) : null}
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="Close modal"
            >
              <XIcon className="size-4" />
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6 sm:py-6">
          {children}
        </div>

        {footer ? (
          <footer className="border-t border-border/70 bg-muted/20 px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-center justify-end gap-3">{footer}</div>
          </footer>
        ) : null}
      </section>
    </div>,
    document.body
  )
}