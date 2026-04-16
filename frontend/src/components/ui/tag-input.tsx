"use client"

import { KeyboardEvent, useState } from "react"
import { XIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type TagInputProps = {
  id?: string
  value: string[]
  onChange: (nextValue: string[]) => void
  placeholder?: string
  disabled?: boolean
  maxTags?: number
  normalizeToLowercase?: boolean
}

function normalizeTag(raw: string, normalizeToLowercase: boolean): string {
  const trimmed = raw.trim()
  if (!trimmed) {
    return ""
  }

  return normalizeToLowercase ? trimmed.toLowerCase() : trimmed
}

export function TagInput({
  id,
  value,
  onChange,
  placeholder = "e.g. react, then press Enter",
  disabled = false,
  maxTags,
  normalizeToLowercase = true,
}: TagInputProps) {
  const [draft, setDraft] = useState("")

  const addTag = (rawTag: string) => {
    const tag = normalizeTag(rawTag, normalizeToLowercase)
    if (!tag) {
      return
    }

    if (value.includes(tag)) {
      return
    }

    if (typeof maxTags === "number" && value.length >= maxTags) {
      return
    }

    onChange([...value, tag])
  }

  const commitDraft = () => {
    addTag(draft)
    setDraft("")
  }

  const removeTag = (target: string) => {
    onChange(value.filter((tag) => tag !== target))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === "," || event.key === "Tab") {
      event.preventDefault()
      if (draft.trim()) {
        commitDraft()
      }
      return
    }

    if (event.key === "Backspace" && !draft && value.length > 0) {
      event.preventDefault()
      onChange(value.slice(0, -1))
    }
  }

  return (
    <div
      className={cn(
        "rounded-md border border-input bg-transparent px-2 py-2",
        disabled && "cursor-not-allowed opacity-60"
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {value.map((tag) => (
          <Badge
            key={tag}
            variant="secondary"
            className="inline-flex items-center gap-1 px-2 py-0.5"
          >
            <span>{tag}</span>
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              disabled={disabled}
              onClick={() => removeTag(tag)}
              className="rounded-xs p-0.5 hover:bg-background/30 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
            >
              <XIcon className="size-3" />
            </button>
          </Badge>
        ))}

        <Input
          id={id}
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (draft.trim()) {
              commitDraft()
            }
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="h-8 min-w-48 flex-1 border-0 bg-transparent px-1 py-0 shadow-none focus-visible:ring-0"
        />
      </div>
    </div>
  )
}
