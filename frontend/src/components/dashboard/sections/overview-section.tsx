"use client"

import { useMemo, useState, useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { RefreshCwIcon, SparklesIcon, UsersIcon } from "lucide-react"
import { Switch } from "@/components/ui/switch"

import {
	getApiErrorMessage,
	getJobsOverview,
	getRequirementOverview,
	getSystemHealth,
	listRequirements,
	type RequirementRead,
} from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
 	MutationState,
 	healthQueryKey,
 	jobsQueryKey,
 	requirementsQueryKey,
} from "@/components/dashboard/sections/shared"
import { toast } from "sonner"

export function OverviewSection() {
	const [selectedRequirementId, setSelectedRequirementId] = useState<number | null>(null)
	const [showAll, setShowAll] = useState<boolean>(false)

	const healthQuery = useQuery({
		queryKey: healthQueryKey,
		queryFn: getSystemHealth,
		refetchInterval: 30_000,
	})

	const jobsQuery = useQuery({
		queryKey: jobsQueryKey,
		queryFn: getJobsOverview,
		refetchInterval: 5_000,
	})

	const requirementsQuery = useQuery<RequirementRead[]>({
		queryKey: [...requirementsQueryKey, showAll ? "all" : "active"],
		queryFn: () => listRequirements({ includeInactive: showAll }),
		// Refetch when this component mounts to ensure selection is fresh
		refetchOnMount: "always",
	})

	const requirements = useMemo(() => requirementsQuery.data ?? [], [requirementsQuery.data])
	
	const displayRequirements = useMemo(() => {
		const safeRequirements = requirements ?? []
		const activeRequirements = safeRequirements.filter((r) => r.is_active)
		const inactiveRequirements = safeRequirements.filter((r) => !r.is_active)
		return showAll ? [...activeRequirements, ...inactiveRequirements] : activeRequirements
	}, [requirements, showAll])

	const effectiveRequirementId = useMemo(() => {
		if (selectedRequirementId !== null) return selectedRequirementId
		if (displayRequirements && displayRequirements.length > 0) {
			return displayRequirements[0].id
		}
		return null
	}, [displayRequirements, selectedRequirementId])

	const overviewQuery = useQuery({
		queryKey: ["requirement-overview", effectiveRequirementId],
		enabled: effectiveRequirementId !== null,
		queryFn: async () => {
			if (effectiveRequirementId === null) return null
			return getRequirementOverview(effectiveRequirementId)
		},
		// Ensure overview metrics are fetched when visiting the page
		refetchOnMount: "always",
	})

	const overview = overviewQuery.data

	useEffect(() => {
		if (healthQuery.isError) {
			toast.error("Unable to reach backend health endpoint", {
				description: getApiErrorMessage(healthQuery.error),
			})
		}
	}, [healthQuery.isError, healthQuery.error])

	return (
		<div className="space-y-6">

			<div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
				<Card>
					<CardHeader>
						<CardTitle>System Health</CardTitle>
						<CardDescription>Backend runtime + model providers</CardDescription>
					</CardHeader>
					<CardContent className="space-y-3">
						{healthQuery.isLoading ? (
							<MutationState
								isLoading
								pendingLabel="Fetching health snapshot"
								idleLabel=""
							/>
						) : (
							<>
								<div className="flex items-center justify-between">
									<span className="text-sm text-muted-foreground">Status</span>
									<Badge>{healthQuery.data?.status ?? "unknown"}</Badge>
								</div>
								<div className="grid grid-cols-2 gap-3 text-sm">
									<div>
										<p className="text-muted-foreground">AI Mode</p>
										<p className="font-medium">{healthQuery.data?.ai_mode ?? "-"}</p>
									</div>
									<div>
										<p className="text-muted-foreground">Provider</p>
										<p className="font-medium">{healthQuery.data?.provider ?? "-"}</p>
									</div>
									<div>
										<p className="text-muted-foreground">LLM</p>
										<p className="font-medium break-all">
											{healthQuery.data?.llm_model ?? "-"}
										</p>
									</div>
									<div>
										<p className="text-muted-foreground">Embedding</p>
										<p className="font-medium break-all">
											{healthQuery.data?.embed_model ?? "-"}
										</p>
									</div>
								</div>
							</>
						)}
					</CardContent>
					<CardFooter>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => {
								void healthQuery.refetch()
								void jobsQuery.refetch()
							}}
						>
							<RefreshCwIcon />
							Refresh Snapshot
						</Button>
					</CardFooter>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Queue Overview</CardTitle>
						<CardDescription>Resume ingestion worker throughput</CardDescription>
					</CardHeader>
					<CardContent className="space-y-3">
						{jobsQuery.isLoading ? (
							<MutationState
								isLoading
								pendingLabel="Reading queue status"
								idleLabel=""
							/>
						) : (
							<>
								<div className="grid grid-cols-3 gap-3">
									<div className="rounded-lg border p-3">
										<p className="text-xs text-muted-foreground">Running</p>
										<p className="text-2xl font-semibold">
											{jobsQuery.data?.running ?? 0}
										</p>
									</div>
									<div className="rounded-lg border p-3">
										<p className="text-xs text-muted-foreground">Queued</p>
										<p className="text-2xl font-semibold">
											{jobsQuery.data?.queued ?? 0}
										</p>
									</div>
									<div className="rounded-lg border p-3">
										<p className="text-xs text-muted-foreground">Workers</p>
										<p className="text-2xl font-semibold">
											{jobsQuery.data?.workers_online ?? 0}
										</p>
									</div>
								</div>
								<p className="text-sm text-muted-foreground">
									Upload resumes in the ingestion tab and monitor progress here.
								</p>
							</>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<div className="flex items-center justify-between gap-2">
							<div>
								<CardTitle>Requirement Overview</CardTitle>
								<CardDescription>
									ATS-style counts per requirement
								</CardDescription>
							</div>
							<div className="flex items-center gap-3">
								<label className="flex items-center gap-2 text-sm text-muted-foreground">
									<span className="text-xs">Show inactive</span>
									<Switch
										size="sm"
										checked={showAll}
										onCheckedChange={(val) => {
											setShowAll(Boolean(val))
											setSelectedRequirementId(null)
										}}
									/>
								</label>
								<UsersIcon className="size-4 text-muted-foreground" />
							</div>
						</div>
					</CardHeader>
					<CardContent className="space-y-3">
						{requirementsQuery.isLoading ? (
							<MutationState
								isLoading
								pendingLabel="Loading requirements overview"
								idleLabel=""
							/>
						) : displayRequirements.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								{showAll ? "No requirements yet." : "No active requirements. Toggle to show inactive ones."}
							</p>
						) : (
							<>
								<div className="space-y-1">
									<p className="text-xs font-semibold uppercase text-muted-foreground">
										Requirement
									</p>
									<select
										className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-sm"
										value={effectiveRequirementId ?? ""}
										onChange={(event) => {
											const value = event.target.value
											if (!value) {
												setSelectedRequirementId(null)
												return
											}
											setSelectedRequirementId(Number(value))
										}}
									>
										{displayRequirements.map((requirement) => (
											<option key={requirement.id} value={requirement.id}>
												{requirement.title}{!requirement.is_active ? " (inactive)" : ""}
											</option>
										))}
									</select>
								</div>
								{effectiveRequirementId === null ? (
									<p className="text-xs text-muted-foreground">
										Select a requirement to see candidate counts.
									</p>
								) : overviewQuery.isLoading ? (
									<MutationState
										isLoading
										pendingLabel="Loading overview"
										idleLabel=""
									/>
								) : overview ? (
									<div className="grid grid-cols-2 gap-2 pt-1 text-xs">
										<div className="rounded-md bg-muted p-2">
											<p className="text-[10px] font-medium uppercase text-muted-foreground">
												Current
											</p>
											<p className="text-base font-semibold">
												{overview.total_current_candidates}
											</p>
										</div>
										<div className="rounded-md bg-muted p-2">
											<p className="text-[10px] font-medium uppercase text-muted-foreground">
												Processing
											</p>
											<p className="text-base font-semibold">
												{overview.total_processing_candidates}
											</p>
										</div>
										<div className="rounded-md bg-muted p-2">
											<p className="text-[10px] font-medium uppercase text-muted-foreground">
												Rejected
											</p>
											<p className="text-base font-semibold">
												{overview.total_rejected_candidates}
											</p>
										</div>
										<div className="rounded-md bg-muted p-2">
											<p className="text-[10px] font-medium uppercase text-muted-foreground">
												Hired
											</p>
											<p className="text-base font-semibold">
												{overview.total_hired_candidates}
											</p>
										</div>
									</div>
								) : (
									<p className="text-xs text-muted-foreground">
										No overview data yet. Run matching for this requirement.
									</p>
								)}
							</>
						)}
					</CardContent>
				</Card>

				<Card className="xl:col-span-1 lg:col-span-2">
					<CardHeader>
						<CardTitle>Workflow Checklist</CardTitle>
						<CardDescription>
							Suggested execution order for HR and recruiting teams
						</CardDescription>
					</CardHeader>
					<CardContent>
						<ul className="space-y-2 text-sm">
							<li className="flex items-start gap-2">
								<SparklesIcon className="mt-0.5 size-4 text-primary" />
								Upload resumes from local files or remote URLs.
							</li>
							<li className="flex items-start gap-2">
								<SparklesIcon className="mt-0.5 size-4 text-primary" />
								Review and clean candidate metadata in the Candidates tab.
							</li>
							<li className="flex items-start gap-2">
								<SparklesIcon className="mt-0.5 size-4 text-primary" />
								Create a requirement profile and run matching on demand.
							</li>
							<li className="flex items-start gap-2">
								<SparklesIcon className="mt-0.5 size-4 text-primary" />
								Export or review ranked candidates with AI match reasons.
							</li>
						</ul>
					</CardContent>
				</Card>
			</div>
		</div>
	)
}
