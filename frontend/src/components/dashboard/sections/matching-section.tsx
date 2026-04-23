"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertCircleIcon, Loader2Icon } from "lucide-react"

import {
	getApiErrorMessage,
	getMatchingResults,
	updateMatchStatus,
	rejectZeroScoreCandidates,
	applyThresholdStatus,
	runCandidateMatching,
	listRequirements,
	runMatching,
	type MatchResultRead,
	type RequirementRead,
} from "@/lib/api-client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card"
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table"
import {
	MutationState,
	Notification,
	requirementsQueryKey,
	toScorePercent,
	type ToastState,
} from "@/components/dashboard/sections/shared"

function statusBadgeVariant(status: MatchResultRead["status"]): "default" | "outline" | "secondary" | "destructive" {
	if (status === "processing") return "secondary"
	if (status === "hired") return "default"
	if (status === "rejected") return "destructive"
	return "outline"
}

export function MatchingSection() {
	const queryClient = useQueryClient()
	const [notification, setNotification] = useState<ToastState | null>(null)
	const [selectedRequirementId, setSelectedRequirementId] = useState<number | null>(
		null
	)
	const [activeMatch, setActiveMatch] = useState<MatchResultRead | null>(null)
	const [thresholdValue, setThresholdValue] = useState<string>("")
	const [thresholdStatus, setThresholdStatus] =
		useState<"processing" | "rejected" | "hired">("processing")
	const [localStatuses, setLocalStatuses] = useState<
		Record<number, MatchResultRead["status"]>
	>({})
	const [matchAll, setMatchAll] = useState<boolean>(false)

	const requirementsQuery = useQuery({
		queryKey: requirementsQueryKey,
		queryFn: listRequirements,
	})

	const effectiveRequirementId = useMemo(() => {
		if (!requirementsQuery.data?.length) {
			return null
		}

		const stillExists = requirementsQuery.data.some(
			(requirement) => requirement.id === selectedRequirementId
		)

		if (stillExists && selectedRequirementId !== null) {
			return selectedRequirementId
		}

		return requirementsQuery.data[0]?.id ?? null
	}, [requirementsQuery.data, selectedRequirementId])

	const matchResultsQuery = useQuery({
		queryKey: ["matching", effectiveRequirementId],
		queryFn: () => getMatchingResults(effectiveRequirementId as number),
		enabled: effectiveRequirementId !== null,
	})

	const updateStatusMutation = useMutation({
		mutationFn: async (variables: {
			requirementId: number
			candidateId: number
			status: "new" | "processing" | "rejected" | "hired"
		}) =>
			updateMatchStatus(variables.requirementId, variables.candidateId, {
				status: variables.status,
			}),
		onSuccess: (_data, variables) => {
			setLocalStatuses((current) => ({
				...current,
				[variables.candidateId]: variables.status,
			}))
			if (
				activeMatch &&
				variables.candidateId === activeMatch.candidate.id &&
				variables.requirementId === effectiveRequirementId
			) {
				setActiveMatch({ ...activeMatch, status: variables.status })
			}
			setNotification({
				type: "success",
				title: "Status updated",
				message: "Candidate status updated for this requirement.",
			})
		},
		onError: (error) => {
			setNotification({
				type: "error",
				title: "Unable to update status",
				message: getApiErrorMessage(error),
			})
		},
	})

	const rejectZeroMutation = useMutation({
		mutationFn: (requirementId: number) => rejectZeroScoreCandidates(requirementId),
		onSuccess: async (result) => {
			await matchResultsQuery.refetch()
			setNotification({
				type: "success",
				title: "Zero-score candidates rejected",
				message: `Updated ${result.updated_count} candidates to rejected.`,
			})
		},
		onError: (error) => {
			setNotification({
				type: "error",
				title: "Bulk reject failed",
				message: getApiErrorMessage(error),
			})
		},
	})

	const thresholdMutation = useMutation({
		mutationFn: async (variables: {
			requirementId: number
			threshold: number
			status: "processing" | "rejected" | "hired"
		}) =>
			applyThresholdStatus(variables.requirementId, {
				threshold: variables.threshold,
				status: variables.status,
			}),
		onSuccess: async (result) => {
			await matchResultsQuery.refetch()
			setNotification({
				type: "success",
				title: "Threshold status applied",
				message: `Updated ${result.updated_count} candidates to ${result.status}.`,
			})
		},
		onError: (error) => {
			setNotification({
				type: "error",
				title: "Threshold update failed",
				message: getApiErrorMessage(error),
			})
		},
	})

	const runCandidateMatchingMutation = useMutation({
		mutationFn: async (variables: { requirementId: number; candidateId: number }) =>
			runCandidateMatching(variables.requirementId, variables.candidateId),
		onSuccess: async (_, variables) => {
			await matchResultsQuery.refetch()
			setNotification({
				type: "success",
				title: "Candidate re-matched",
				message: `Matching refreshed for candidate #${variables.candidateId}.`,
			})
		},
		onError: (error) => {
			setNotification({
				type: "error",
				title: "Per-candidate matching failed",
				message: getApiErrorMessage(error),
			})
		},
	})

	const runMatchingMutation = useMutation({
		mutationFn: (variables: { requirementId: number; matchAll?: boolean }) =>
			runMatching(variables.requirementId, variables.matchAll),
		onSuccess: (results, variables) => {
			setSelectedRequirementId(variables.requirementId)
			setLocalStatuses({})
			queryClient.setQueryData(["matching", variables.requirementId], results)
			setNotification({
				type: "success",
				title: "Matching completed",
				message: `Generated ${results.length} ranked results.`,
			})
		},
		onError: (error) => {
			setNotification({
				type: "error",
				title: "Matching failed",
				message: getApiErrorMessage(error),
			})
		},
	})

	const selectedRequirement = useMemo<RequirementRead | undefined>(() => {
		return requirementsQuery.data?.find(
			(requirement) => requirement.id === effectiveRequirementId
		)
	}, [effectiveRequirementId, requirementsQuery.data])

	const rankedCandidates = matchResultsQuery.data ?? []

	function scoreColorClass(percent: number) {
		if (percent >= 75) return "text-emerald-600 font-semibold"
		if (percent >= 50) return "text-amber-600 font-semibold"
		return "text-destructive font-semibold"
	}

	const showStatusColumn = !matchAll && effectiveRequirementId !== null

	return (
		<div className="space-y-6">
			<Notification
				state={notification}
				onDismiss={() => setNotification(null)}
			/>

			<Card>
				<CardHeader>
					<CardTitle>Run Candidate Matching</CardTitle>
					<CardDescription>
						Select a requirement and run AI ranking against the candidate pool.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<Field orientation="responsive">
						<FieldContent>
							<FieldLabel htmlFor="matching-requirement">Requirement</FieldLabel>
							<FieldDescription>
								Choose the role profile to score and rank candidates.
							</FieldDescription>
						</FieldContent>
						<div className="w-full max-w-5xl">
							<div className="flex items-center gap-2 min-w-0">
								<div className="flex-1 min-w-0">
									<Select
										value={effectiveRequirementId ? String(effectiveRequirementId) : ""}
										onValueChange={(value) => {
											const parsed = Number(value)
											setSelectedRequirementId(Number.isFinite(parsed) ? parsed : null)
										}}
									>
										<SelectTrigger id="matching-requirement" className="w-full md:max-w-[75ch] pr-4">
											<SelectValue placeholder="Select requirement" />
										</SelectTrigger>
										<SelectContent>
											{requirementsQuery.data?.map((requirement) => (
												<SelectItem key={requirement.id} value={String(requirement.id)}>
													#{requirement.id} - {requirement.title}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								<div className="flex items-center gap-1 flex-shrink-0">
									<label className="text-sm text-muted-foreground">Include all candidates</label>
									<Switch
										aria-label="Include all candidates"
										size="sm"
										checked={matchAll}
										onCheckedChange={(val) => setMatchAll(Boolean(val))}
									/>
								</div>
							</div>
						</div>
					</Field>

					{selectedRequirement?.skills?.length ? (
						<div className="flex flex-wrap gap-2">
							{selectedRequirement.skills.map((skill) => (
								<Badge key={`selected-${skill.name}`} variant="outline">
									{skill.min_experience_years != null
										? `${skill.name} (${skill.min_experience_years}+y)`
										: skill.name}
								</Badge>
							))}
						</div>
					) : null}

					{/* Buttons and badge placed below skills, right-aligned */}
					<div className="mt-4 flex justify-start">
						<div className="flex items-center gap-2 flex-wrap">
							<Button
								type="button"
								disabled={
									effectiveRequirementId === null || runMatchingMutation.isPending
								}
								onClick={() => {
									if (effectiveRequirementId !== null) {
										runMatchingMutation.mutate({ requirementId: effectiveRequirementId, matchAll })
									}
								}}
							>
								{runMatchingMutation.isPending && (
									<Loader2Icon className="animate-spin" />
									)}
								Run Matching
								</Button>
								<Button
									type="button"
									variant="outline"
									disabled={effectiveRequirementId === null}
									onClick={() => {
										void matchResultsQuery.refetch()
									}}
								>
									Refresh Results
								</Button>
								{selectedRequirement && (
									<Badge className="ml-2" variant="secondary">{selectedRequirement.title}</Badge>
								)}
						</div>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Match Results</CardTitle>
					<CardDescription>
						Per-requirement match scores and workflow status.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{effectiveRequirementId !== null && rankedCandidates.length > 0 ? (
						<div className="mb-4 flex flex-wrap items-end gap-3">
							<div className="space-y-1">
								<p className="text-xs font-semibold uppercase text-muted-foreground">
									Bulk Actions
								</p>
								<div className="flex flex-wrap items-center gap-2">
									<Button
										 type="button"
										 variant="outline"
										 disabled={rejectZeroMutation.isPending}
										 onClick={() => {
											if (effectiveRequirementId !== null) {
												rejectZeroMutation.mutate(effectiveRequirementId)
											}
										}}
									>
										{rejectZeroMutation.isPending && (
											<Loader2Icon className="mr-1 size-4 animate-spin" />
										)}
										Reject All Zero Score Candidates
									</Button>
								</div>
							</div>
							<div className="space-y-1">
								<p className="text-xs font-semibold uppercase text-muted-foreground">
									Threshold Status
								</p>
								<div className="flex flex-wrap items-center gap-2">
									<Field>
										<FieldLabel htmlFor="threshold-score">
											Score &lt; Threshold
										</FieldLabel>
										<Input
											id="threshold-score"
											className="w-24"
											inputMode="numeric"
											value={thresholdValue}
											onChange={(event) => {
												setThresholdValue(event.target.value)
											}}
											placeholder="40"
										/>
									</Field>
									<Field>
										<FieldLabel>Status</FieldLabel>
										<Select
											value={thresholdStatus}
											onValueChange={(value) => {
												if (
													value === "processing" ||
													value === "rejected" ||
													value === "hired"
												) {
													setThresholdStatus(value)
												}
											}}
										>
											<SelectTrigger className="w-40">
												<SelectValue placeholder="Select status" />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="processing">Processing</SelectItem>
												<SelectItem value="rejected">Rejected</SelectItem>
												<SelectItem value="hired">Hired</SelectItem>
											</SelectContent>
										</Select>
									</Field>
									<Button
										 type="button"
										 disabled={
											thresholdMutation.isPending ||
											!thresholdValue.trim()
										}
										 onClick={() => {
											if (effectiveRequirementId === null) return

											const parsed = Number(thresholdValue)
											if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
												setNotification({
													type: "error",
													title: "Invalid threshold",
													message: "Enter a score from 0 to 100.",
												})
												return
											}

											thresholdMutation.mutate({
												requirementId: effectiveRequirementId,
												threshold: parsed,
												status: thresholdStatus,
											})
										}}
									>
										{thresholdMutation.isPending && (
											<Loader2Icon className="mr-1 size-4 animate-spin" />
										)}
										Apply Threshold Status
									</Button>
								</div>
							</div>
						</div>
					) : null}
					{matchResultsQuery.isLoading ? (
						<MutationState
							isLoading
							pendingLabel="Loading match results"
							idleLabel=""
						/>
					) : matchResultsQuery.isError ? (
						<Alert variant="destructive">
							<AlertCircleIcon className="size-4" />
							<AlertTitle>Unable to load match results</AlertTitle>
							<AlertDescription>
								{getApiErrorMessage(matchResultsQuery.error)}
							</AlertDescription>
						</Alert>
					) : rankedCandidates.length === 0 ? (
						<Alert>
							<AlertCircleIcon className="size-4" />
							<AlertTitle>No match results yet</AlertTitle>
							<AlertDescription>
								Run matching for the selected requirement to populate this view.
							</AlertDescription>
						</Alert>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
										<TableHead>Candidate</TableHead>
										<TableHead>Experience</TableHead>
										<TableHead>Location</TableHead>
										<TableHead>Score</TableHead>
										{showStatusColumn && <TableHead>Status</TableHead>}
										<TableHead>Reason</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
							</TableHeader>
							<TableBody>
								{rankedCandidates.map((result: MatchResultRead) => (
									<TableRow key={`match-${result.candidate.id}`}>
										<TableCell className="font-medium">
											{result.candidate.name ?? `Candidate #${result.candidate.id}`}
										</TableCell>
										<TableCell>{result.candidate.experience_years ?? "-"}</TableCell>
										<TableCell>{result.candidate.location ?? "-"}</TableCell>
										<TableCell>
											{(() => {
												const pct = toScorePercent(result.score)
												return <span className={scoreColorClass(pct)}>{pct}%</span>
											})()}
										</TableCell>
										{showStatusColumn ? (
											<TableCell>
												{(() => {
													const status = localStatuses[result.candidate.id] ?? result.status
													return (
														<Badge variant={statusBadgeVariant(status)}>
															{status}
														</Badge>
													)
												})()}
											</TableCell>
										) : null}
										<TableCell className="max-w-130 whitespace-normal">
											{result.reason}
										</TableCell>
										<TableCell className="text-right">
											<div className="flex items-center justify-end gap-2">
												<Select
													value={localStatuses[result.candidate.id] ?? result.status}
													onValueChange={(value) => {
														if (effectiveRequirementId === null) return
														if (
															value !== "new" &&
															value !== "processing" &&
															value !== "rejected" &&
															value !== "hired"
														) {
															return
														}
														updateStatusMutation.mutate({
															requirementId: effectiveRequirementId,
															candidateId: result.candidate.id,
															status: value,
														})
													}}
													disabled={updateStatusMutation.isPending}
												>
													<SelectTrigger className="w-32">
														<SelectValue placeholder="Set status" />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="new">New</SelectItem>
														<SelectItem value="processing">Processing</SelectItem>
														<SelectItem value="rejected">Rejected</SelectItem>
														<SelectItem value="hired">Hired</SelectItem>
													</SelectContent>
												</Select>
												<Button
													 type="button"
													 size="sm"
													 variant="ghost"
													 onClick={() => setActiveMatch(result)}
												>
													Details
												</Button>
											</div>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			{activeMatch && effectiveRequirementId !== null ? (
				<Card>
					<CardHeader>
						<CardTitle>
							Candidate Workflow – {activeMatch.candidate.name ?? `#${activeMatch.candidate.id}`}
						</CardTitle>
						<CardDescription>
							Role: {activeMatch.requirement.title}
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="flex flex-wrap items-center gap-3 items-baseline">
							<Badge variant={statusBadgeVariant(activeMatch.status)}>
								Status: {activeMatch.status}
							</Badge>
							<div className="text-sm">
								Score: <span className={scoreColorClass(toScorePercent(activeMatch.score))}>{toScorePercent(activeMatch.score)}%</span>
							</div>
						</div>
						<p className="text-sm text-muted-foreground">
							{activeMatch.reason}
						</p>
						<div className="flex flex-wrap items-center gap-2">
							<Button
								 type="button"
								 variant="outline"
								 disabled={updateStatusMutation.isPending}
								 onClick={() => {
									updateStatusMutation.mutate({
										requirementId: effectiveRequirementId,
										candidateId: activeMatch.candidate.id,
										status: "processing",
									})
								}}
							>
								Mark Processing
							</Button>
							<Button
								 type="button"
								 variant="outline"
								 disabled={updateStatusMutation.isPending}
								 onClick={() => {
									updateStatusMutation.mutate({
										requirementId: effectiveRequirementId,
										candidateId: activeMatch.candidate.id,
										status: "rejected",
									})
								}}
							>
								Mark Rejected
							</Button>
							<Button
								 type="button"
								 variant="outline"
								 disabled={updateStatusMutation.isPending}
								 onClick={() => {
									updateStatusMutation.mutate({
										requirementId: effectiveRequirementId,
										candidateId: activeMatch.candidate.id,
										status: "hired",
									})
								}}
							>
								Mark Hired
							</Button>
							<Button
								 type="button"
								 variant="outline"
								 disabled={
									activeMatch.status !== "new" ||
									runCandidateMatchingMutation.isPending
								}
								 onClick={() => {
									if (activeMatch.status !== "new") return
									runCandidateMatchingMutation.mutate({
										requirementId: effectiveRequirementId,
										candidateId: activeMatch.candidate.id,
									})
								}}
							>
								{runCandidateMatchingMutation.isPending ? (
										<Loader2Icon className="mr-1 size-4 animate-spin" />
									) : null}
								Run Matching For This Candidate
							</Button>
							<Button
								 type="button"
								 variant="ghost"
								 onClick={() => setActiveMatch(null)}
							>
								Close
							</Button>
						</div>
					</CardContent>
				</Card>
			) : null}
		</div>
	)
}
