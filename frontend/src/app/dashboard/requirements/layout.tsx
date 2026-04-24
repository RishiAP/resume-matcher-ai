import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Requirements — Resume Matcher AI",
  description: "Manage requirements for Resume Matcher AI.",
}

export default function RequirementsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
