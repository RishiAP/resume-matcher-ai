import type { Metadata } from "next"
import { OverviewSection } from "@/components/dashboard/sections/overview-section"

export const metadata: Metadata = {
  title: "Overview — Resume Matcher AI",
  description: "Dashboard overview: quick stats and recent activity.",
}

export default function DashboardRootPage() {
  return <OverviewSection />
}
