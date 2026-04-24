import type { Metadata } from "next"
import { DashboardShell } from "@/components/dashboard/dashboard-shell"

export const metadata: Metadata = {
  title: "Dashboard — Resume Matcher AI",
  description:
    "Dashboard: manage candidates, upload resumes, and run AI-powered matching.",
}

type DashboardLayoutProps = {
  children: React.ReactNode
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  return <DashboardShell>{children}</DashboardShell>
}
