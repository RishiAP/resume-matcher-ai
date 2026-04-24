import type { Metadata } from "next"
import { RequirementsSection } from "@/components/dashboard/sections/requirements-section"

export const metadata: Metadata = {
  title: "Requirements — Resume Matcher AI",
  description: "Create and manage job requirement profiles for candidate matching.",
}

export default function DashboardRequirementsPage() {
  return <RequirementsSection />
}
