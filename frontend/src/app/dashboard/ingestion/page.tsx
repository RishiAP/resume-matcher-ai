import type { Metadata } from "next"
import { ResumeIngestionSection } from "@/components/dashboard/sections/ingestion-section"

export const metadata: Metadata = {
  title: "Ingestion — Resume Matcher AI",
  description: "Upload resumes and manage ingestion tasks.",
}

export default function DashboardIngestionPage() {
  return <ResumeIngestionSection />
}
