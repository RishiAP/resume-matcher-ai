"use client"

import Link from "next/link"
import {
  ActivityIcon,
  BriefcaseBusinessIcon,
  BrainCircuitIcon,
  FileUpIcon,
  UsersIcon,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"

export type DashboardSection =
  | "overview"
  | "ingestion"
  | "candidates"
  | "requirements"
  | "matching"

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  activeSection: DashboardSection
}

export const dashboardSections: {
  id: DashboardSection
  label: string
  href: string
  icon: React.ReactNode
}[] = [
  {
    id: "overview",
    label: "Overview",
    href: "/dashboard",
    icon: <ActivityIcon />,
  },
  {
    id: "requirements",
    label: "Requirements",
    href: "/dashboard/requirements",
    icon: <BriefcaseBusinessIcon />,
  },
  {
    id: "ingestion",
    label: "Ingestion",
    href: "/dashboard/ingestion",
    icon: <FileUpIcon />,
  },
  {
    id: "candidates",
    label: "Candidates",
    href: "/dashboard/candidates",
    icon: <UsersIcon />,
  },
  {
    id: "matching",
    label: "Matching",
    href: "/dashboard/matching",
    icon: <BrainCircuitIcon />,
  },
]

export function getDashboardSectionFromPathname(
  pathname: string | null | undefined
): DashboardSection {
  if (!pathname) {
    return "overview"
  }

  const normalizedPath =
    pathname.endsWith("/") && pathname.length > 1
      ? pathname.slice(0, -1)
      : pathname

  if (normalizedPath === "/dashboard") {
    return "overview"
  }

  if (
    normalizedPath === "/dashboard/overview" ||
    normalizedPath.startsWith("/dashboard/overview/")
  ) {
    return "overview"
  }

  const matchedSection = dashboardSections
    .filter((section) => section.id !== "overview")
    .find(
    (section) =>
      normalizedPath === section.href ||
      normalizedPath.startsWith(`${section.href}/`)
    )

  return matchedSection?.id ?? "overview"
}

export function AppSidebar({
  activeSection,
  ...props
}: AppSidebarProps) {
  return (
    <Sidebar variant="inset" collapsible="icon" {...props}>
      <SidebarHeader className="gap-2 group-data-[collapsible=icon]:items-center">
        <div className="overflow-hidden rounded-lg border border-sidebar-border/60 bg-sidebar-accent/40 px-3 py-2 transition-all duration-200 group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:py-2">
          <p className="text-xs tracking-wide text-sidebar-foreground/70 uppercase group-data-[collapsible=icon]:hidden">
            Resume Matcher AI
          </p>
          <p className="mt-1 text-sm font-semibold group-data-[collapsible=icon]:hidden">
            Recruitment Console
          </p>
          <p className="hidden text-center text-xs font-semibold tracking-wide text-sidebar-foreground group-data-[collapsible=icon]:block">
            RM
          </p>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="pt-1">
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarMenu className="gap-1.5 pt-1">
            {dashboardSections.map((item) => (
              <SidebarMenuItem key={item.id}>
                <SidebarMenuButton
                  asChild
                  isActive={activeSection === item.id}
                  tooltip={item.label}
                >
                  <Link href={item.href}>
                    {item.icon}
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
