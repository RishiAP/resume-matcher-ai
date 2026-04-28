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
              className="h-12 gap-3 rounded-lg px-3 py-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:rounded-none bg-transparent border-0 hover:bg-transparent focus:bg-transparent"
            >
              <Link href="/dashboard" aria-label="Resume Matcher AI">
                {/* small favicon: visible only when sidebar is collapsed */}
                <div className="hidden group-data-[collapsible=icon]:flex h-8 w-8 items-center justify-center">
                  <Image
                    src="/favicon-32x32.png"
                    alt="Resume Matcher AI"
                    width={32}
                    height={32}
                    className="h-8 w-8"
                    priority
                  />
                </div>

                {/* large raw logo: visible only when sidebar is expanded (no border or hover box) */}
                <div className="relative h-10 w-40 group-data-[collapsible=icon]:hidden">
                  <Image
                    src="/NextICron-logo-white.png"
                    alt="Resume Matcher AI"
                    fill
                    sizes="(max-width: 640px) 140px, 160px"
                    style={{ objectFit: "contain" }}
                    priority
                  />
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="pt-1">
          <SidebarGroupLabel>Recruitment Console</SidebarGroupLabel>
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
