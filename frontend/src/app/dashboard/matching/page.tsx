import type { Metadata } from "next"
import { MatchingSection } from "@/components/dashboard/sections/matching-section"

export const metadata: Metadata = {
  title: "Matching — Resume Matcher AI",
  description: "Run AI-powered matching for requirements and review results.",
}

export default function DashboardMatchingPage() {
  return <MatchingSection />
}
