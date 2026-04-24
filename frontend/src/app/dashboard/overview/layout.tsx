import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Overview — Resume Matcher AI",
  description: "View an overview of Resume Matcher AI functionality.",
}

export default function OverviewLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
