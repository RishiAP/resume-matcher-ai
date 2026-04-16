"use client"

import { usePathname } from "next/navigation"
import { useQuery } from "@tanstack/react-query"

import {
  AppSidebar,
  dashboardSections,
  getDashboardSectionFromPathname,
} from "@/components/app-sidebar"
import { Badge } from "@/components/ui/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { getJobsOverview } from "@/lib/api-client"

type DashboardShellProps = {
  children: React.ReactNode
}

export function DashboardShell({ children }: DashboardShellProps) {
  const pathname = usePathname()
  const activeSection = getDashboardSectionFromPathname(pathname)

  const activeSectionMeta =
    dashboardSections.find((section) => section.id === activeSection) ??
    dashboardSections[0]

  const jobsQuery = useQuery({
    queryKey: ["resume-jobs"],
    queryFn: getJobsOverview,
    refetchInterval: 5_000,
  })

  return (
    <SidebarProvider className="h-svh overflow-hidden">
      <AppSidebar activeSection={activeSection} />
      <SidebarInset className="min-h-0 overflow-hidden">
        <div className="sticky top-0 z-30 shrink-0 border-b border-border/60 bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80">
          <header className="flex h-16 shrink-0 items-center justify-between gap-3 px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
            <div className="flex min-w-0 items-center gap-2">
              <SidebarTrigger className="-ml-1" />
              <Separator
                orientation="vertical"
                className="mr-2 data-vertical:h-4 data-vertical:self-auto"
              />
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbPage>{activeSectionMeta?.label ?? "Overview"}</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </div>

            <div className="hidden items-center gap-2 lg:flex">
              <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Queue Snapshot
              </span>
              <Badge className="border border-primary/20 bg-primary/10 text-primary hover:bg-primary/10">
                Running {jobsQuery.data?.running ?? 0}
              </Badge>
              <Badge variant="outline" className="border-border/80 bg-card/60">
                Queued {jobsQuery.data?.queued ?? 0}
              </Badge>
              <Badge variant="outline" className="border-border/80 bg-card/60">
                Workers {jobsQuery.data?.workers_online ?? 0}
              </Badge>
            </div>
          </header>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
