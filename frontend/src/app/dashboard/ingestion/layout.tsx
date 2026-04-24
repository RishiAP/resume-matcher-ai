import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Ingestion — Resume Matcher AI",
  description: "Manage data ingestion for Resume Matcher AI.",
}

export default function IngestionLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}