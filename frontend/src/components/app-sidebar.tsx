"use client"

import Link from "next/link"
import Image from "next/image"
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
  SidebarFooter,
} from "@/components/ui/sidebar"
import { NavUser } from "@/components/nav-user"

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
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              size="lg"
              className="h-12 gap-3 rounded-lg border border-sidebar-border/60 bg-sidebar-accent/40 px-3 py-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:rounded-none group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent"
            >
              <Link href="/dashboard">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-background/50 ring-1 ring-border/60 group-data-[collapsible=icon]:rounded-none group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:ring-0">
                  <Image
                    src="/favicon-32x32.png"
                    alt="Resume Matcher AI"
                    width={32}
                    height={32}
                    className="h-8 w-8"
                    priority
                  />
                </div>
                <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                  <span className="text-sm font-semibold">Resume Matcher AI</span>
                  <span className="text-xs text-muted-foreground">Recruitment Console</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
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

      <SidebarFooter className="mt-auto">
        <NavUser />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
