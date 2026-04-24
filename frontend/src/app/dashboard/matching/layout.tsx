import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Matching — Resume Matcher AI",
  description: "Manage AI-powered matching for Resume Matcher AI.",
}

export default function MatchingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}