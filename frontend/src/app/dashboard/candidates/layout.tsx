import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Candidates — Resume Matcher AI",
  description: "View and manage candidates, comments, and profiles.",
}

export default function CandidatesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}