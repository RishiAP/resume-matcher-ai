"use client"

import { useEffect, useId, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Controller, useForm } from "react-hook-form"
import {
	AlertCircleIcon,
	EyeIcon,
	Loader2Icon,
	PencilIcon,
} from "lucide-react"
import { z } from "zod"

import {
	addCandidateComment,
	updateCandidateComment,
	getApiErrorMessage,
	listCandidates,
	updateCandidate,
	listRequirements,
	type CandidateFilters,
	type CandidateRead,
	type CandidateUpdate,
	type HRCommentRead,
	type RequirementRead,
} from "@/lib/api-client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card"
import { CustomModal } from "@/components/ui/custom-modal"
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { TagInput } from "@/components/ui/tag-input"
import {
	MutationState,
	Notification,
	candidateDisplayValue,
	toOptionalInt,
	requirementsQueryKey,
	type ToastState,
} from "@/components/dashboard/sections/shared"

const candidateFiltersSchema = z
	.object({
		skills: z.array(z.string().trim().min(1)).optional().default([]),
		skillMatchMode: z.enum(["all", "any"]).default("all"),
		minExperience: z
			.string()
			.optional()
			.refine((value) => !value || /^\d+$/.test(value), {
				message: "Min experience must be a whole number.",
			}),
		maxExperience: z
			.string()
			.optional()
			.refine((value) => !value || /^\d+$/.test(value), {
				message: "Max experience must be a whole number.",
			}),
		location: z.string().optional(),
	})
	.refine(
		(value) => {
			const min = toOptionalInt(value.minExperience)
			const max = toOptionalInt(value.maxExperience)

			if (typeof min === "number" && typeof max === "number") {
				return max >= min
			}

			return true
		},
		{
			message: "Max experience should be greater than or equal to min experience.",
			path: ["maxExperience"],
		}
	)

type CandidateFilterValues = z.input<typeof candidateFiltersSchema>

const candidateUpdateSchema = z.object({
	interview_date: z.union([
		z
			.string()
			.regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD date format."),
		z.literal(""),
	]),
	interview_time: z.union([
		z
			.string()
			.regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:mm time format."),
		z.literal(""),
	]),
})

type CandidateUpdateValues = z.input<typeof candidateUpdateSchema>

type SkillProfile = NonNullable<CandidateRead["skill_profiles"]>[number]

const skillContextPriority: Record<SkillProfile["context"], number> = {
	primary: 0,
	secondary: 1,
	project: 2,
	mentioned: 3,
}

function normalizeSkillNames(skills: string[] | null | undefined): string[] {
	return skills?.map((skill) => skill.trim()).filter(Boolean) ?? []
}

function dedupeSkillNames(skills: string[] | null | undefined): string[] {
	const seen = new Set<string>()
	const unique: string[] = []

	for (const skill of normalizeSkillNames(skills)) {
		const key = skill.toLowerCase()
		if (seen.has(key)) {
			continue
		}
		seen.add(key)
		unique.push(skill)
	}

	return unique
}

function buildOrderedSkills(candidate: CandidateRead | null | undefined): {
	matched: string[]
	remaining: string[]
} {
	if (!candidate) {
		return { matched: [], remaining: [] }
	}

	const matched = dedupeSkillNames(candidate.matched_skills)
	const ranked = dedupeSkillNames(
		rankSkillsByMonths(candidate.skill_profiles, candidate.skills)
	)

	const matchedSet = new Set(matched.map((skill) => skill.toLowerCase()))

	const remaining = ranked.filter((skill) => {
		const key = skill.toLowerCase()
		return !matchedSet.has(key)
	})

	return { matched, remaining }
}

function toSkillMonths(profile: SkillProfile): number {
	if (typeof profile.experience_months === "number") {
		return profile.experience_months
	}
	if (typeof profile.experience_years === "number") {
		return Math.round(profile.experience_years * 12)
	}
	return 0
}

function rankSkillsByMonths(
	skillProfiles: CandidateRead["skill_profiles"] | null | undefined,
	fallbackSkills: string[] | null | undefined
): string[] {
	if (!skillProfiles?.length) {
		return normalizeSkillNames(fallbackSkills)
	}

	const bySkill = new Map<
		string,
		{ name: string; months: number; contextPriority: number }
	>()

	for (const profile of skillProfiles) {
		const normalizedName = profile.name?.trim()
		if (!normalizedName) {
			continue
		}

		const key = normalizedName.toLowerCase()
		const months = toSkillMonths(profile)
		const contextPriority = skillContextPriority[profile.context]
		const existing = bySkill.get(key)

		if (
			!existing ||
			contextPriority < existing.contextPriority ||
			(contextPriority === existing.contextPriority && months > existing.months)
		) {
			bySkill.set(key, {
				name: normalizedName,
				months,
				contextPriority,
			})
		}
	}

	if (!bySkill.size) {
		return normalizeSkillNames(fallbackSkills)
	}

	return [...bySkill.values()]
		.sort(
			(left, right) =>
				left.contextPriority - right.contextPriority ||
				right.months - left.months ||
				left.name.localeCompare(right.name)
		)
		.map((entry) => entry.name)
}

function formatCommentTimestamp(value: string | null | undefined): string {
	if (!value) {
		return "-"
	}

	const parsed = new Date(value)
	if (Number.isNaN(parsed.getTime())) {
		return value
	}

	return parsed.toLocaleString()
}

function commentTimeValue(value: string | null | undefined): number {
	if (!value) {
		return 0
	}
	const parsed = new Date(value)
	if (Number.isNaN(parsed.getTime())) {
		return 0
	}
	return parsed.getTime()
}

function sortCommentsByNewest(comments: HRCommentRead[]): HRCommentRead[] {
	return [...comments].sort(
		(a, b) => commentTimeValue(b.created_at) - commentTimeValue(a.created_at)
	)
}

function candidateQueryKey(filters?: CandidateFilters): readonly [
	string,
	string,
	string,
	string,
	string,
	string,
	string,
] {
	const safeFilters = filters ?? {}

	return [
		"candidates",
		safeFilters.skills?.join(",") ?? "",
		safeFilters.min_exp?.toString() ?? "",
		safeFilters.max_exp?.toString() ?? "",
		safeFilters.location?.trim() ?? "",
		safeFilters.skill_match_mode ?? "all",
		safeFilters.requirement_id?.toString() ?? "",
	] as const
}

function CandidateViewModal({
	candidate,
	onClose,
	onEdit,
}: {
	candidate: CandidateRead | null
	onClose: () => void
	onEdit: (candidate: CandidateRead) => void
}) {
	const orderedSkills = buildOrderedSkills(candidate)

	const interviewSchedule = [candidate?.interview_date, candidate?.interview_time]
		.map((value) => value?.trim() ?? "")
		.filter(Boolean)
		.join(" • ")

	const commentHistory = sortCommentsByNewest(candidate?.hr_comments ?? [])

	return (
		<CustomModal
			open={Boolean(candidate)}
			onClose={onClose}
			size="xl"
			title={
				candidate?.name?.trim()
					? candidate.name
					: candidate
						? `Candidate #${candidate.id}`
						: "Candidate Profile"
			}
			description="Review extracted details before making interview updates."
			footer={
				<>
					<Button type="button" variant="outline" onClick={onClose}>
						Close
					</Button>
					{candidate ? (
						<Button type="button" onClick={() => onEdit(candidate)}>
							<PencilIcon />
							Edit Candidate
						</Button>
					) : null}
				</>
			}
		>
			{candidate ? (
				<div className="space-y-6">
					<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
						<div className="rounded-xl border border-border/70 bg-muted/20 p-3">
							<p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
								Experience
							</p>
							<p className="mt-1 text-sm font-semibold">
								{candidate.experience_years != null
									? `${candidate.experience_years} years`
									: "-"}
							</p>
						</div>
						<div className="rounded-xl border border-border/70 bg-muted/20 p-3">
							<p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
								Current Company
							</p>
							<p className="mt-1 text-sm font-semibold">
								{candidateDisplayValue(candidate.current_company)}
							</p>
						</div>
						<div className="rounded-xl border border-border/70 bg-muted/20 p-3">
							<p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
								Location
							</p>
							<p className="mt-1 text-sm font-semibold">
								{candidateDisplayValue(candidate.location)}
							</p>
						</div>
					</div>

					<div className="grid gap-4 lg:grid-cols-2">
						<div className="rounded-xl border border-border/70 bg-card p-4">
							<p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
								Contact Details
							</p>
							<dl className="mt-3 grid gap-3 text-sm">
								<div>
									<dt className="text-muted-foreground">Email</dt>
									<dd className="font-medium break-all">
										{candidateDisplayValue(candidate.email)}
									</dd>
								</div>
								<div>
									<dt className="text-muted-foreground">Phone</dt>
									<dd className="font-medium">
										{candidateDisplayValue(candidate.phone)}
									</dd>
								</div>
								<div>
									<dt className="text-muted-foreground">Highest Degree</dt>
									<dd className="font-medium">
										{candidateDisplayValue(candidate.highest_degree)}
									</dd>
								</div>
								<div>
									<dt className="text-muted-foreground">Year Of Passing</dt>
									<dd className="font-medium">
										{candidateDisplayValue(candidate.year_of_passing, "Present")}
									</dd>
								</div>
							</dl>
						</div>

						<div className="rounded-xl border border-border/70 bg-card p-4">
							<p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
								Interview Snapshot
							</p>
							<dl className="mt-3 grid gap-3 text-sm">
								<div>
									<dt className="text-muted-foreground">Scheduled</dt>
									<dd className="font-medium">
										{candidateDisplayValue(interviewSchedule)}
									</dd>
								</div>
								<div>
									<dt className="text-muted-foreground">HR Comments</dt>
									{commentHistory.length ? (
										<dd className="space-y-2">
											{commentHistory.map((comment) => (
												<div
													key={`candidate-comment-${candidate.id}-${comment.id}`}
													className="rounded-md border border-border/60 bg-muted/20 p-2"
												>
													<p className="text-sm leading-relaxed whitespace-pre-wrap">
														{comment.comment}
													</p>
													<p className="mt-1 text-xs text-muted-foreground">
														{formatCommentTimestamp(comment.created_at)}
													</p>
												</div>
											))}
										</dd>
									) : (
										<dd className="font-medium">-</dd>
									)}
								</div>
							</dl>
						</div>
					</div>

					<div className="rounded-xl border border-border/70 bg-card p-4">
						<p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
							Skills
						</p>
						{orderedSkills.matched.length || orderedSkills.remaining.length ? (
							<div className="mt-3 space-y-3">
								{orderedSkills.matched.length ? (
									<div className="flex flex-wrap gap-2">
										{orderedSkills.matched.map((skill) => (
											<Badge
												key={`candidate-view-${candidate.id}-matched-${skill}`}
												className="border border-emerald-300 bg-emerald-100 text-emerald-900 hover:bg-emerald-100"
											>
												{skill}
											</Badge>
										))}
									</div>
								) : null}
								{orderedSkills.remaining.length ? (
									<div className="flex flex-wrap gap-2">
										{orderedSkills.remaining.map((skill) => (
											<Badge
												key={`candidate-view-${candidate.id}-remaining-${skill}`}
												variant="secondary"
											>
												{skill}
											</Badge>
										))}
									</div>
								) : null}
							</div>
						) : (
							<p className="mt-3 text-sm text-muted-foreground">
								Skills were not extracted for this profile.
							</p>
						)}
					</div>

					<div className="rounded-xl border border-border/70 bg-card p-4">
						<p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
							Work Experience
						</p>
						{candidate.experiences?.length ? (
							<div className="mt-3 space-y-3">
								{candidate.experiences.map((experience, index) => {
									const experienceSkills = normalizeSkillNames(
										experience.skills_used
									)

									return (
										<div
											key={`candidate-experience-${candidate.id}-${index}`}
											className="rounded-lg border border-border/60 bg-muted/20 p-3"
										>
											<p className="text-sm font-semibold">
												{candidateDisplayValue(experience.role)} at{" "}
												{candidateDisplayValue(experience.company)}
											</p>
											<p className="mt-1 text-xs text-muted-foreground">
												{candidateDisplayValue(experience.start_date, "-", { monthYear: true })} to {candidateDisplayValue(experience.end_date, "Present", { monthYear: true })}
											</p>
											<div className="mt-2 flex flex-wrap gap-2">
												{experienceSkills.length ? (
													experienceSkills.map((skill) => (
														<Badge
															key={`candidate-experience-skills-${candidate.id}-${index}-${skill}`}
															variant="secondary"
														>
															{skill}
														</Badge>
													))
												) : (
													<span className="text-sm text-muted-foreground">-</span>
												)}
											</div>
										</div>
									)
								})}
							</div>
						) : (
							<p className="mt-3 text-sm text-muted-foreground">
								No work experience entries are available.
							</p>
						)}
					</div>

					<div className="rounded-xl border border-border/70 bg-card p-4">
						<p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
							Projects
						</p>
						{candidate.projects?.length ? (
							<div className="mt-3 space-y-3">
								{candidate.projects.map((project, index) => {
									const projectSkills = normalizeSkillNames(project.skills_used)

									return (
										<div
											key={`candidate-project-${candidate.id}-${index}`}
											className="rounded-lg border border-border/60 bg-muted/20 p-3"
										>
											<p className="text-sm font-semibold">
												{candidateDisplayValue(project.name)}
											</p>
											<p className="mt-1 text-xs text-muted-foreground">
												{candidateDisplayValue(project.start_date, "-", { monthYear: true })} to {candidateDisplayValue(project.end_date, "Present", { monthYear: true })}
											</p>
											<p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">
												{candidateDisplayValue(project.description)}
											</p>
											<div className="mt-2 flex flex-wrap gap-2">
												{projectSkills.length ? (
													projectSkills.map((skill) => (
														<Badge
															key={`candidate-project-skills-${candidate.id}-${index}-${skill}`}
															variant="secondary"
														>
															{skill}
														</Badge>
													))
												) : (
													<span className="text-sm text-muted-foreground">-</span>
												)}
											</div>
										</div>
									)
								})}
							</div>
						) : (
							<p className="mt-3 text-sm text-muted-foreground">
								No project entries are available.
							</p>
						)}
					</div>

					<div className="rounded-xl border border-border/70 bg-card p-4">
						<p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
							Education History
						</p>
						{candidate.educations?.length ? (
							<div className="mt-3 space-y-3">
								{candidate.educations.map((education, index) => (
									<div
										key={`candidate-education-${candidate.id}-${index}`}
										className="rounded-lg border border-border/60 bg-muted/20 p-3"
									>
										<p className="text-sm font-semibold">
											{candidateDisplayValue(education.degree_name)} at{" "}
											{candidateDisplayValue(education.institute)}
										</p>
										<p className="mt-1 text-xs text-muted-foreground">
											{candidateDisplayValue(education.branch_name)} •{" "}
											{candidateDisplayValue(education.start_date, "-", { monthYear: true })} to {candidateDisplayValue(education.end_date, "Present", { monthYear: true })} • {`Year - `} 
											{candidateDisplayValue(education.year_of_passing, "Present")} • GPA{" "}
											{candidateDisplayValue(education.gpa)}
										</p>
									</div>
								))}
							</div>
						) : (
							<p className="mt-3 text-sm text-muted-foreground">
								No education entries are available.
							</p>
						)}
					</div>
				</div>
			) : null}
		</CustomModal>
	)
}

function CandidateEditModal({
	candidate,
	isSavingDetails,
	isAddingComment,
	updatingCommentId,
	onClose,
	onSaveDetails,
	onAddComment,
	onUpdateComment,
}: {
	candidate: CandidateRead | null
	isSavingDetails: boolean
	isAddingComment: boolean
	updatingCommentId: number | null
	onClose: () => void
	onSaveDetails: (candidateId: number, payload: CandidateUpdate) => Promise<void>
	onAddComment: (candidateId: number, comment: string) => Promise<void>
	onUpdateComment: (
		candidateId: number,
		commentId: number,
		comment: string
	) => Promise<void>
}) {
	const form = useForm<CandidateUpdateValues>({
		resolver: zodResolver(candidateUpdateSchema),
		defaultValues: {
			interview_date: "",
			interview_time: "",
		},
	})
	const formId = useId()
	const [newComment, setNewComment] = useState("")
	const [commentDrafts, setCommentDrafts] = useState<Record<number, string>>(() =>
		Object.fromEntries(
			(candidate?.hr_comments ?? []).map((row) => [row.id, row.comment])
		)
	)

	useEffect(() => {
		if (!candidate) {
			form.reset({
				interview_date: "",
				interview_time: "",
			})
			return
		}

		form.reset({
			interview_date: candidate.interview_date ?? "",
			interview_time: candidate.interview_time ?? "",
		})
	}, [candidate, form])

	const sortedComments = sortCommentsByNewest(candidate?.hr_comments ?? [])

	return (
		<CustomModal
			open={Boolean(candidate)}
			onClose={onClose}
			size="xl"
			title={
				candidate?.name?.trim() ? `Edit ${candidate.name}` : "Update Candidate"
			}
			description="Update interview workflow fields and manage HR comments separately with backend-generated timestamps."
			footer={
				<>
					<Button type="button" variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button type="submit" form={formId} disabled={isSavingDetails}>
						{isSavingDetails && <Loader2Icon className="animate-spin" />}
						Save Interview Details
					</Button>
				</>
			}
		>
			<form
				id={formId}
				className="space-y-6"
				onSubmit={form.handleSubmit(async (values) => {
					if (!candidate) {
						return
					}

					await onSaveDetails(candidate.id, {
						interview_date: values.interview_date || null,
						interview_time: values.interview_time || null,
					})
				})}
			>
				{candidate ? (
					<div className="rounded-xl border border-border/70 bg-muted/20 p-4">
						<p className="text-sm font-semibold">
							{candidate.name ?? `Candidate #${candidate.id}`}
						</p>
						<div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
							<p>Email: {candidateDisplayValue(candidate.email)}</p>
							<p>Phone: {candidateDisplayValue(candidate.phone)}</p>
							<p>Location: {candidateDisplayValue(candidate.location)}</p>
							<p>
								Experience: {candidate.experience_years != null
									? `${candidate.experience_years} years`
									: "-"}
							</p>
						</div>
					</div>
				) : null}

				<FieldSet>
					<FieldLegend>Interview Details</FieldLegend>
					<FieldGroup className="grid gap-4 md:grid-cols-2">
						<Controller
							name="interview_date"
							control={form.control}
							render={({ field, fieldState }) => (
								<Field data-invalid={fieldState.invalid}>
									<FieldLabel htmlFor="candidate-interview-date">
										Interview Date
									</FieldLabel>
									<Input
										{...field}
										id="candidate-interview-date"
										type="date"
										aria-invalid={fieldState.invalid}
									/>
									<FieldError errors={[fieldState.error]} />
								</Field>
							)}
						/>

						<Controller
							name="interview_time"
							control={form.control}
							render={({ field, fieldState }) => (
								<Field data-invalid={fieldState.invalid}>
									<FieldLabel htmlFor="candidate-interview-time">
										Interview Time
									</FieldLabel>
									<Input
										{...field}
										id="candidate-interview-time"
										type="time"
										aria-invalid={fieldState.invalid}
									/>
									<FieldError errors={[fieldState.error]} />
								</Field>
							)}
						/>
					</FieldGroup>
				</FieldSet>

				<FieldSet>
					<FieldLegend>HR Comments</FieldLegend>
					<FieldDescription>
						Timestamps are generated and stored by the backend automatically.
					</FieldDescription>

					{sortedComments.length ? (
						<div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3">
							<p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
								Existing Comments (Latest First)
							</p>
							{sortedComments.map((comment) => {
								const draft = commentDrafts[comment.id] ?? comment.comment
								const hasChanges = draft.trim() !== comment.comment.trim()

								return (
									<div
										key={`candidate-edit-comment-${candidate?.id}-${comment.id}`}
										className="space-y-2 rounded-md border border-border/60 bg-card/80 p-3"
									>
										<Textarea
											value={draft}
											onChange={(event) => {
												setCommentDrafts((current) => ({
													...current,
													[comment.id]: event.target.value,
												}))
											}}
											className="min-h-20"
										/>
										<div className="flex flex-wrap items-center justify-between gap-2">
											<div className="text-xs text-muted-foreground">
												<p>Added {formatCommentTimestamp(comment.created_at)}</p>
												{comment.updated_at && comment.updated_at !== comment.created_at ? (
													<p>Updated {formatCommentTimestamp(comment.updated_at)}</p>
												) : null}
											</div>
											<Button
												type="button"
												variant="outline"
												size="sm"
												disabled={
													isAddingComment ||
													updatingCommentId === comment.id ||
													!draft.trim() ||
													!hasChanges
												}
												onClick={async () => {
													if (!candidate) {
														return
													}
													await onUpdateComment(candidate.id, comment.id, draft)
												}}
											>
												{updatingCommentId === comment.id ? (
													<Loader2Icon className="animate-spin" />
												) : null}
												Save Edit
											</Button>
										</div>
									</div>
								)
							})}
						</div>
					) : (
						<p className="text-sm text-muted-foreground">No HR comments yet.</p>
					)}

					<Field>
						<FieldLabel htmlFor="candidate-comments">Add HR Comment</FieldLabel>
						<Textarea
							id="candidate-comments"
							value={newComment}
							onChange={(event) => setNewComment(event.target.value)}
							className="min-h-24"
							placeholder="e.g. Strong communication, good system design, schedule round 2"
						/>
						<div className="flex justify-end">
							<Button
								type="button"
								disabled={isAddingComment || !newComment.trim() || !candidate}
								onClick={async () => {
									if (!candidate || !newComment.trim()) {
										return
									}
									await onAddComment(candidate.id, newComment)
									setNewComment("")
								}}
							>
								{isAddingComment ? <Loader2Icon className="animate-spin" /> : null}
								Add HR Comment
							</Button>
						</div>
					</Field>
				</FieldSet>
			</form>
		</CustomModal>
	)
}

export function CandidatesSection() {
	const queryClient = useQueryClient()
	const [notification, setNotification] = useState<ToastState | null>(null)
	const [filters, setFilters] = useState<CandidateFilters>({})
	const [selectedRequirementId, setSelectedRequirementId] =
		useState<number | null>(null)
	const [viewCandidate, setViewCandidate] = useState<CandidateRead | null>(null)
	const [editCandidate, setEditCandidate] = useState<CandidateRead | null>(
		null
	)
	const [updatingCommentId, setUpdatingCommentId] = useState<number | null>(null)

	const requirementsQuery = useQuery<RequirementRead[]>({
		queryKey: requirementsQueryKey,
		queryFn: listRequirements,
	})

	const activeRequirementId =
		selectedRequirementId === -1
			? null
			: selectedRequirementId ?? requirementsQuery.data?.[0]?.id ?? null

	const showStatusColumn = selectedRequirementId !== -1 && activeRequirementId !== null

	const filterForm = useForm<CandidateFilterValues>({
		resolver: zodResolver(candidateFiltersSchema),
		defaultValues: {
			skills: [],
			skillMatchMode: "all",
			minExperience: "",
			maxExperience: "",
			location: "",
		},
	})

	const candidatesQuery = useQuery({
		queryKey: candidateQueryKey({
			...filters,
			requirement_id: activeRequirementId ?? undefined,
		}),
		queryFn: () =>
			listCandidates({
				...filters,
				requirement_id: activeRequirementId ?? undefined,
			}),
		// Always refetch when this component mounts (e.g. user navigates to page)
		refetchOnMount: "always",
	})

	const updateCandidateMutation = useMutation({
		mutationFn: ({
			candidateId,
			payload,
		}: {
			candidateId: number
			payload: CandidateUpdate
		}) => updateCandidate(candidateId, payload),
		onSuccess: (updated) => {
			setNotification({
				type: "success",
				title: "Candidate updated",
				message: "Interview details have been saved.",
			})
			setEditCandidate(updated)
			setViewCandidate((current) =>
				current?.id === updated.id ? updated : current
			)
			// Invalidate and refetch candidate lists so UI reflects updates immediately
			void queryClient.invalidateQueries({ queryKey: ["candidates"] })
			void queryClient.refetchQueries({ queryKey: ["candidates"], exact: false })
		},
		onError: (error) => {
			setNotification({
				type: "error",
				title: "Interview update failed",
				message: getApiErrorMessage(error),
			})
		},
	})

	const addCommentMutation = useMutation({
		mutationFn: ({
			candidateId,
			comment,
		}: {
			candidateId: number
			comment: string
		}) => addCandidateComment(candidateId, { comment }),
		onSuccess: (created, variables) => {
			setNotification({
				type: "success",
				title: "HR comment added",
				message: "Comment has been saved with backend timestamp.",
			})

			setEditCandidate((current) => {
				if (!current || current.id !== variables.candidateId) {
					return current
				}
				const existing = current.hr_comments ?? []
				return {
					...current,
					hr_comments: sortCommentsByNewest([created, ...existing]),
				}
			})

			setViewCandidate((current) => {
				if (!current || current.id !== variables.candidateId) {
					return current
				}
				const existing = current.hr_comments ?? []
				return {
					...current,
					hr_comments: sortCommentsByNewest([created, ...existing]),
				}
			})

			// Invalidate and refetch candidate lists so UI reflects new comments
			void queryClient.invalidateQueries({ queryKey: ["candidates"] })
			void queryClient.refetchQueries({ queryKey: ["candidates"], exact: false })
		},
		onError: (error) => {
			setNotification({
				type: "error",
				title: "Add comment failed",
				message: getApiErrorMessage(error),
			})
		},
	})

	const updateCommentMutation = useMutation({
		mutationFn: ({
			candidateId,
			commentId,
			comment,
		}: {
			candidateId: number
			commentId: number
			comment: string
		}) => updateCandidateComment(candidateId, commentId, { comment }),
		onMutate: ({ commentId }) => {
			setUpdatingCommentId(commentId)
		},
		onSuccess: (updated, variables) => {
			setNotification({
				type: "success",
				title: "HR comment updated",
				message: "Previous comment was edited successfully.",
			})

			const patchComments = (comments: HRCommentRead[] | undefined) => {
				const rows = comments ?? []
				return sortCommentsByNewest(
					rows.map((row) => (row.id === variables.commentId ? updated : row))
				)
			}

			setEditCandidate((current) => {
				if (!current || current.id !== variables.candidateId) {
					return current
				}
				return {
					...current,
					hr_comments: patchComments(current.hr_comments),
				}
			})

			setViewCandidate((current) => {
				if (!current || current.id !== variables.candidateId) {
					return current
				}
				return {
					...current,
					hr_comments: patchComments(current.hr_comments),
				}
			})

			// Invalidate and refetch candidate lists so edited comments are visible
			void queryClient.invalidateQueries({ queryKey: ["candidates"] })
			void queryClient.refetchQueries({ queryKey: ["candidates"], exact: false })
		},
		onError: (error) => {
			setNotification({
				type: "error",
				title: "Edit comment failed",
				message: getApiErrorMessage(error),
			})
		},
		onSettled: () => {
			setUpdatingCommentId(null)
		},
	})

	const hasActiveSkillFilter = Boolean(filters.skills?.length)
	const activeSkillMode = filters.skill_match_mode ?? "all"

	const switchToAnyMode = () => {
		const values = filterForm.getValues()
		filterForm.setValue("skillMatchMode", "any")
		setFilters({
			skills: values.skills?.length ? values.skills : undefined,
			skill_match_mode: "any",
			min_exp: toOptionalInt(values.minExperience),
			max_exp: toOptionalInt(values.maxExperience),
			location: values.location?.trim() || undefined,
			requirement_id: activeRequirementId ?? undefined,
		})
	}

	return (
		<div className="space-y-6">
			<Notification
				state={notification}
				onDismiss={() => setNotification(null)}
			/>

			<Card>
				<CardHeader>
					<CardTitle>Requirement Context</CardTitle>
					<CardDescription>
						Candidates are shown for the selected requirement.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Field orientation="responsive">
						<FieldLabel>Requirement</FieldLabel>
						<Select
							value={
								activeRequirementId !== null
									? activeRequirementId.toString()
									: "ALL"
							}
							onValueChange={(value) => {
								if (value === "ALL") {
									setSelectedRequirementId(-1)
									return
								}
								const parsed = Number(value)
								setSelectedRequirementId(Number.isFinite(parsed) ? parsed : null)
							}}
							disabled={
								requirementsQuery.isLoading ||
								!requirementsQuery.data?.length
							}
						>
							<SelectTrigger className="w-full max-w-md">
								<SelectValue
									placeholder={
										requirementsQuery.data?.length
											? "Select a requirement"
											: "No requirements available"
									}
								/>
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="ALL">All candidates</SelectItem>
								{requirementsQuery.data?.map((requirement) => (
									<SelectItem
										key={requirement.id}
										value={requirement.id.toString()}
									>
										{requirement.title}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Field>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Candidate Filters</CardTitle>
					<CardDescription>
						Narrow down profiles by skills, experience, and location.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form
						className="space-y-4"
						onSubmit={filterForm.handleSubmit((values) => {
							const parsed: CandidateFilters = {
								skills: values.skills?.length ? values.skills : undefined,
								skill_match_mode: values.skillMatchMode,
								min_exp: toOptionalInt(values.minExperience),
								max_exp: toOptionalInt(values.maxExperience),
								location: values.location?.trim() || undefined,
								requirement_id: activeRequirementId ?? undefined,
							}

							setFilters(parsed)
						})}
					>
						<FieldGroup className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
							<Controller
								name="skills"
								control={filterForm.control}
								render={({ field, fieldState }) => (
									<Field data-invalid={fieldState.invalid}>
										<FieldLabel htmlFor="filter-skills">Skills</FieldLabel>
										<TagInput
											id="filter-skills"
											value={field.value ?? []}
											onChange={field.onChange}
											placeholder="e.g. react, then press Enter"
										/>
										<FieldDescription>
											Add one skill per tag using Enter, comma, or tab.
										</FieldDescription>
										<FieldError errors={[fieldState.error]} />
									</Field>
								)}
							/>

							<Controller
								name="skillMatchMode"
								control={filterForm.control}
								render={({ field, fieldState }) => (
									<Field data-invalid={fieldState.invalid}>
										<FieldLabel htmlFor="filter-skill-mode">Skill Mode</FieldLabel>
										<Select value={field.value} onValueChange={field.onChange}>
											<SelectTrigger id="filter-skill-mode" className="w-full">
												<SelectValue placeholder="Select mode" />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="all">All Skills (strict)</SelectItem>
												<SelectItem value="any">Any Skill (relaxed)</SelectItem>
											</SelectContent>
										</Select>
										<FieldDescription>
											Default is All Skills for exact skill coverage.
										</FieldDescription>
										<FieldError errors={[fieldState.error]} />
									</Field>
								)}
							/>

							<Controller
								name="minExperience"
								control={filterForm.control}
								render={({ field, fieldState }) => (
									<Field data-invalid={fieldState.invalid}>
										<FieldLabel htmlFor="filter-min-exp">Min Experience</FieldLabel>
										<Input
											{...field}
											id="filter-min-exp"
											inputMode="numeric"
											aria-invalid={fieldState.invalid}
											placeholder="e.g. 2"
										/>
										<FieldError errors={[fieldState.error]} />
									</Field>
								)}
							/>

							<Controller
								name="maxExperience"
								control={filterForm.control}
								render={({ field, fieldState }) => (
									<Field data-invalid={fieldState.invalid}>
										<FieldLabel htmlFor="filter-max-exp">Max Experience</FieldLabel>
										<Input
											{...field}
											id="filter-max-exp"
											inputMode="numeric"
											aria-invalid={fieldState.invalid}
											placeholder="e.g. 8"
										/>
										<FieldError errors={[fieldState.error]} />
									</Field>
								)}
							/>

							<Controller
								name="location"
								control={filterForm.control}
								render={({ field, fieldState }) => (
									<Field data-invalid={fieldState.invalid}>
										<FieldLabel htmlFor="filter-location">Location</FieldLabel>
										<Input
											{...field}
											id="filter-location"
											aria-invalid={fieldState.invalid}
											placeholder="e.g. Bengaluru"
										/>
										<FieldError errors={[fieldState.error]} />
									</Field>
								)}
							/>
						</FieldGroup>

						<div className="flex flex-wrap gap-3">
							<Button type="submit">Apply Filters</Button>
							<Button
								type="button"
								variant="outline"
								onClick={() => {
									filterForm.reset({
										skills: [],
										skillMatchMode: "all",
										minExperience: "",
										maxExperience: "",
										location: "",
									})
									setFilters({
										requirement_id: activeRequirementId ?? undefined,
									})
								}}
							>
								Reset
							</Button>
						</div>
					</form>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Candidate Directory</CardTitle>
					<CardDescription>
						{candidatesQuery.data?.length ?? 0} candidates found.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{candidatesQuery.isLoading ? (
						<MutationState
							isLoading
							pendingLabel="Loading candidates"
							idleLabel=""
						/>
					) : candidatesQuery.isError ? (
						<Alert variant="destructive">
							<AlertCircleIcon className="size-4" />
							<AlertTitle>Unable to load candidates</AlertTitle>
							<AlertDescription>
								{getApiErrorMessage(candidatesQuery.error)}
							</AlertDescription>
						</Alert>
					) : (candidatesQuery.data?.length ?? 0) === 0 ? (
						<Alert>
							<AlertCircleIcon className="size-4" />
							<AlertTitle>No candidates found</AlertTitle>
							<AlertDescription>
								No candidates matched the current filters.
							</AlertDescription>
							{hasActiveSkillFilter && activeSkillMode === "all" ? (
								<div className="mt-3">
									<Button type="button" variant="outline" onClick={switchToAnyMode}>
										No exact matches. Try Any skill mode.
									</Button>
								</div>
							) : null}
						</Alert>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Name</TableHead>
									<TableHead>Experience</TableHead>
									<TableHead>Location</TableHead>
									<TableHead>Skills</TableHead>
									<TableHead>Email</TableHead>
									<TableHead>Phone Number</TableHead>
									<TableHead>Qualification</TableHead>
									{showStatusColumn && <TableHead>Status</TableHead>}
									<TableHead className="text-right">Action</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{candidatesQuery.data?.map((candidate) => {
									const orderedSkills = buildOrderedSkills(candidate)
									const visibleSkills = [
										...orderedSkills.matched,
										...orderedSkills.remaining,
									].slice(0, 3)
									const matchedSet = new Set(
										orderedSkills.matched.map((skill) => skill.toLowerCase())
									)

									return (
										<TableRow key={candidate.id}>
										<TableCell className="font-medium">
											{candidate.name ?? `Candidate #${candidate.id}`}
										</TableCell>
										<TableCell>{candidate.experience_years ?? "-"}</TableCell>
										<TableCell>{candidate.location ?? "-"}</TableCell>
										<TableCell>
											{visibleSkills.length ? (
												<Tooltip>
													<TooltipTrigger asChild>
														<div className="flex max-w-70 flex-wrap gap-1 cursor-pointer">
															{visibleSkills.map((skill) => (
																<Badge
																	key={`candidate-skills-inline-${candidate.id}-${skill}`}
																	variant={matchedSet.has(skill.toLowerCase()) ? undefined : "secondary"}
																	className={matchedSet.has(skill.toLowerCase()) ? "border border-emerald-300 bg-emerald-100 text-emerald-900 hover:bg-emerald-100" : undefined}
																>
																	{skill}
																</Badge>
															))}
															{orderedSkills.matched.length + orderedSkills.remaining.length > 3 && (
																<Badge variant="outline">
																	+{orderedSkills.matched.length + orderedSkills.remaining.length - 3}
																</Badge>
															)}
														</div>
													</TooltipTrigger>
													<TooltipContent sideOffset={8} className="flex flex-wrap gap-1 bg-background text-foreground">
														{[...orderedSkills.matched, ...orderedSkills.remaining].map((skill) => (
															<Badge
																key={`candidate-skills-tooltip-${candidate.id}-${skill}`}
																variant={matchedSet.has(skill.toLowerCase()) ? undefined : "outline"}
																className={matchedSet.has(skill.toLowerCase()) ? "border border-emerald-300 bg-emerald-100 text-emerald-900 hover:bg-emerald-100" : undefined}
															>
																{skill}
															</Badge>
														))}
													</TooltipContent>
												</Tooltip>
											) : (
												"-"
											)}
										</TableCell>
										<TableCell>{candidate.email ?? "-"}</TableCell>
										<TableCell>{candidate.phone ?? "-"}</TableCell>
										<TableCell>{candidate.highest_degree ?? "-"}</TableCell>
										{showStatusColumn ? (
											<TableCell>
												{candidate.requirement_status == null
													? "-"
													: candidate.requirement_status === "not_applied"
													? "Not applied"
													: candidate.requirement_status.charAt(0).toUpperCase() + candidate.requirement_status.slice(1)}
											</TableCell>
										) : null}
										<TableCell className="text-right">
											<div className="flex justify-end gap-2">
												<Button
													type="button"
													variant="ghost"
													size="sm"
													onClick={() => setViewCandidate(candidate)}
												>
													<EyeIcon />
													View
												</Button>
												<Button
													type="button"
													variant="outline"
													size="sm"
													onClick={() => setEditCandidate(candidate)}
												>
													<PencilIcon />
													Edit
												</Button>
											</div>
										</TableCell>
									</TableRow>
									)
								})}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			<CandidateViewModal
				candidate={viewCandidate}
				onClose={() => setViewCandidate(null)}
				onEdit={(candidate) => {
					setViewCandidate(null)
					setEditCandidate(candidate)
				}}
			/>

			<CandidateEditModal
				key={editCandidate?.id ?? -1}
				candidate={editCandidate}
				isSavingDetails={updateCandidateMutation.isPending}
				isAddingComment={addCommentMutation.isPending}
				updatingCommentId={updatingCommentId}
				onClose={() => setEditCandidate(null)}
				onSaveDetails={async (candidateId, payload) => {
					await updateCandidateMutation.mutateAsync({
						candidateId,
						payload,
					})
				}}
				onAddComment={async (candidateId, comment) => {
					await addCommentMutation.mutateAsync({
						candidateId,
						comment,
					})
				}}
				onUpdateComment={async (candidateId, commentId, comment) => {
					await updateCommentMutation.mutateAsync({
						candidateId,
						commentId,
						comment,
					})
				}}
			/>
		</div>
	)
}
