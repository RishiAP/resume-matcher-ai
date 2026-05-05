"use client"

import { useId, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Controller, useForm } from "react-hook-form"
import {
	AlertCircleIcon,
	EyeIcon,
	Loader2Icon,
	PencilIcon,
	PlusIcon,
} from "lucide-react"
import { z } from "zod"

import {
	createCandidateInterview,
	updateCandidateInterview,
	getApiErrorMessage,
	listCandidates,
	updateMatchStatus,
	listRequirements,
	type CandidateFilters,
	type CandidateRead,
	type InterviewRead,
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
import { Switch } from "@/components/ui/switch"
import {
 	MutationState,
 	candidateDisplayValue,
 	toOptionalInt,
 	requirementsQueryKey,
} from "@/components/dashboard/sections/shared"
import { toast } from "sonner"

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

type SkillProfile = NonNullable<CandidateRead["skill_profiles"]>[number]

type InterviewItem = {
	id: number
	comment?: string | null
	created_at?: string | null | undefined
	updated_at?: string | null | undefined
	interview_date?: string | null
	interview_time?: string | null
	round?: number | null | undefined
	isNew?: boolean
}

type CandidateWithInterviews = CandidateRead & { interviews?: InterviewItem[] }

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

function interviewDateTimeValue(interview_date?: string | null, interview_time?: string | null, created_at?: string | null | undefined): number {
	if (interview_date) {
		// Combine date and time (if provided) into an ISO-ish string; fall back to midnight
		const timePart = interview_time ? interview_time : "00:00"
		const dt = new Date(`${interview_date}T${timePart}`)
		if (!Number.isNaN(dt.getTime())) {
			return dt.getTime()
		}
	}
	// fallback to creation time
	return commentTimeValue(created_at)
}

function deriveInterviews(candidate: CandidateRead | null | undefined): InterviewItem[] {
	if (!candidate) return []

	return (candidate.interviews ?? [])
		.map((i) => ({
			id: Number(i.id),
			comment: i.comment ?? "",
			created_at: i.created_at ?? null,
			updated_at: i.updated_at ?? null,
			interview_date: i.interview_date ?? null,
			interview_time: i.interview_time ?? null,
			round: typeof i.round === "number" ? i.round : null,
		}))
		.sort((a, b) =>
			interviewDateTimeValue(b.interview_date, b.interview_time, b.created_at) -
			interviewDateTimeValue(a.interview_date, a.interview_time, a.created_at)
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
	isReadOnly,
}: {
	candidate: CandidateWithInterviews | null
	onClose: () => void
	onEdit: (candidate: CandidateWithInterviews) => void
	isReadOnly?: boolean
}) {
	const orderedSkills = buildOrderedSkills(candidate)

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
					{candidate && !isReadOnly ? (
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
								Interviews
							</p>
							{(() => {
								const interviews = deriveInterviews(candidate)
								return interviews.length ? (
									<div className="mt-3 space-y-2">
										{interviews.map((iv) => (
											<div
												key={`candidate-interview-${candidate?.id}-${iv.id}`}
												className="rounded-lg border border-border/60 bg-muted/20 p-3"
											>
												<div className="flex flex-wrap items-center gap-2">
													{iv.round ? (
														<span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
															Round {iv.round}
														</span>
													) : null}
													{iv.interview_date ? (
														<span className="text-xs font-medium text-foreground">
															{iv.interview_date}
															{iv.interview_time ? ` at ${iv.interview_time}` : ""}
														</span>
													) : null}
												</div>
												{iv.comment ? (
													<p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-foreground">
														{iv.comment}
													</p>
												) : (
													<p className="mt-1 text-xs text-muted-foreground italic">No notes</p>
												)}
											</div>
										))}
									</div>
								) : (
									<p className="mt-3 text-sm text-muted-foreground">No interviews scheduled yet.</p>
								)
							})()}
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
	isAddingComment,
	updatingCommentId,
	onClose,
	onAddComment,
	onUpdateComment,
}: {
	candidate: CandidateWithInterviews | null
	isAddingComment: boolean
	updatingCommentId: number | null
	onClose: () => void
	onAddComment: (candidateId: number, comment: string, interview_date?: string | null, interview_time?: string | null) => Promise<InterviewRead>
	onUpdateComment: (
		candidateId: number,
		commentId: number,
		comment: string,
		interview_date?: string | null,
		interview_time?: string | null,
	) => Promise<InterviewRead>
}) {
	const formId = useId()
	const [localInterviews, setLocalInterviews] = useState<InterviewItem[]>(() => deriveInterviews(candidate))
	const [tempIdCounter, setTempIdCounter] = useState(-1)

	const sortedInterviews = [...localInterviews].sort((a, b) =>
		interviewDateTimeValue(b.interview_date, b.interview_time, b.created_at) -
		interviewDateTimeValue(a.interview_date, a.interview_time, a.created_at)
	)

	return (
		<CustomModal
			open={Boolean(candidate)}
			onClose={onClose}
			size="xl"
			title={
				candidate?.name?.trim() ? `Edit ${candidate.name}` : "Update Candidate"
			}
			description="Manage interview rounds, dates, and notes. Timestamps are generated by the backend."
			footer={
				<>
					<Button type="button" variant="outline" onClick={onClose}>
						Close
					</Button>
				</>
			}
		>
			<div id={formId} className="space-y-6">
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

				<div>
					<div className="mb-3 flex items-center justify-between">
						<div>
							<p className="text-sm font-semibold">Interviews</p>
							<p className="text-xs text-muted-foreground">
								Add or edit interview rounds. Timestamps are stored by the backend.
							</p>
						</div>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => {
								const tempId = tempIdCounter
								setTempIdCounter((v) => v - 1)
								setLocalInterviews((cur) => [
									{
										id: tempId,
										isNew: true,
										comment: "",
										created_at: null,
										updated_at: null,
										interview_date: null,
										interview_time: null,
										round: undefined,
									},
									...cur,
								])
							}}
						>
							<PlusIcon className="size-4" />
							Add Interview
						</Button>
					</div>

					{sortedInterviews.length ? (
						<div className="space-y-3">
							{sortedInterviews.map((iv) => {
								const isNew = iv.isNew || iv.id < 0
								const original = deriveInterviews(candidate).find((o) => o.id === iv.id)
								const hasChanges = isNew
									? Boolean(iv.comment?.trim() || iv.interview_date || iv.interview_time)
									: Boolean(
										  !original ||
											  (original?.comment ?? "").trim() !== (iv.comment ?? "").trim() ||
											  (original.interview_date ?? null) !== (iv.interview_date ?? null) ||
											  (original.interview_time ?? null) !== (iv.interview_time ?? null)
									  )

								return (
									<div
										key={`candidate-edit-interview-${candidate?.id}-${iv.id}`}
										className="rounded-lg border border-border/60 bg-card p-4 space-y-3"
									>
										<div className="flex items-center justify-between">
											<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
												{isNew ? "New Interview" : iv.round ? `Round ${iv.round}` : "Interview"}
											</p>
											{isNew ? (
												<Button
													type="button"
													variant="ghost"
													size="sm"
													onClick={() => setLocalInterviews((cur) => cur.filter((x) => x.id !== iv.id))}
												>
													Remove
												</Button>
											) : null}
										</div>
										<div className="grid gap-3 sm:grid-cols-2">
											<Field>
												<FieldLabel>Date</FieldLabel>
												<Input
													type="date"
													value={iv.interview_date ?? ""}
													onChange={(e) => {
														const v = e.target.value || null
														setLocalInterviews((cur) => cur.map((x) => x.id === iv.id ? { ...x, interview_date: v } : x))
													}}
												/>
											</Field>
											<Field>
												<FieldLabel>Time</FieldLabel>
												<Input
													type="time"
													value={iv.interview_time ?? ""}
													onChange={(e) => {
														const v = e.target.value || null
														setLocalInterviews((cur) => cur.map((x) => x.id === iv.id ? { ...x, interview_time: v } : x))
													}}
												/>
											</Field>
										</div>
										<Field>
											<FieldLabel>Notes</FieldLabel>
											<Textarea
												value={iv.comment ?? ""}
												onChange={(e) => setLocalInterviews((cur) => cur.map((x) => x.id === iv.id ? { ...x, comment: e.target.value } : x))}
												placeholder="Add interview notes, feedback, or observations..."
												className="min-h-24"
											/>
										</Field>
										<div className="flex justify-end">
											<Button
												type="button"
												size="sm"
												disabled={
													isAddingComment ||
													updatingCommentId === iv.id ||
													!hasChanges
												}
												onClick={async () => {
													if (!candidate) return
													if (isNew) {
														const created = await onAddComment(candidate.id, iv.comment ?? "", iv.interview_date ?? null, iv.interview_time ?? null)
														if (created && typeof created === "object" && created.id) {
															setLocalInterviews((cur) => cur.map((x) => x.id === iv.id ? {
																id: created.id,
																comment: created.comment ?? "",
																created_at: created.created_at ?? null,
																updated_at: created.updated_at ?? null,
																interview_date: created.interview_date ?? null,
																interview_time: created.interview_time ?? null,
																round: created.round ?? null,
															} : x))
														}
													} else {
														const updated = await onUpdateComment(candidate.id, iv.id, iv.comment ?? "", iv.interview_date ?? null, iv.interview_time ?? null)
														if (updated && typeof updated === "object" && updated.id) {
															setLocalInterviews((cur) => cur.map((x) => x.id === iv.id ? {
																id: updated.id,
																comment: updated.comment ?? "",
																created_at: updated.created_at ?? null,
																updated_at: updated.updated_at ?? null,
																interview_date: updated.interview_date ?? null,
																interview_time: updated.interview_time ?? null,
																round: updated.round ?? null,
															} : x))
														}
													}
												}}
											>
												{(isAddingComment && isNew) || updatingCommentId === iv.id ? (
													<Loader2Icon className="animate-spin" />
												) : null}
												{isNew ? "Save Interview" : "Update Interview"}
											</Button>
										</div>
									</div>
								)
							})}
						</div>
					) : (
						<div className="rounded-lg border border-dashed border-border p-8 text-center">
							<p className="text-sm text-muted-foreground">No interviews yet.</p>
							<p className="mt-1 text-xs text-muted-foreground">Click &quot;Add Interview&quot; to schedule one.</p>
						</div>
					)}
				</div>
			</div>
		</CustomModal>
	)
}

export function CandidatesSection() {
	const queryClient = useQueryClient()

	const [filters, setFilters] = useState<CandidateFilters>({})
	const [selectedRequirementId, setSelectedRequirementId] =
		useState<number | null>(null)
	const [showInactiveRequirements, setShowInactiveRequirements] = useState(false)
	const [viewCandidate, setViewCandidate] = useState<CandidateWithInterviews | null>(null)
	const [editCandidate, setEditCandidate] = useState<CandidateWithInterviews | null>(
		null
	)
	const [updatingCommentId, setUpdatingCommentId] = useState<number | null>(null)

	const requirementsQuery = useQuery<RequirementRead[]>({
		queryKey: [...requirementsQueryKey, showInactiveRequirements],
		queryFn: () => listRequirements({ includeInactive: showInactiveRequirements }),
	})

	const activeRequirementId =
		selectedRequirementId === -1
			? null
			: selectedRequirementId ?? requirementsQuery.data?.find(r => r.is_active)?.id ?? null

	// Derive whether the currently selected requirement is inactive
	const selectedRequirement = requirementsQuery.data?.find(r => r.id === activeRequirementId) ?? null
	const isSelectedRequirementInactive = selectedRequirement !== null && !selectedRequirement.is_active

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

	const updateRequirementStatusMutation = useMutation({
		mutationFn: async (variables: {
			requirementId: number
			candidateId: number
			status: "not_applied" | "new" | "processing" | "rejected" | "hired"
		}) =>
			updateMatchStatus(variables.requirementId, variables.candidateId, {
				status: variables.status,
			}),
		onSuccess: async (_data, variables) => {
			toast.success("Status updated", {
				description: "Candidate requirement status updated.",
			})
			if (activeRequirementId === variables.requirementId) {
				await candidatesQuery.refetch()
			}
		},
		onError: (error) => {
			toast.error("Unable to update status", {
				description: getApiErrorMessage(error),
			})
		},
	})

	const addCommentMutation = useMutation({
		mutationFn: ({
			candidateId,
			comment,
			interview_date,
			interview_time,
		}: {
			candidateId: number
			comment: string
			interview_date?: string | null
			interview_time?: string | null
		}) => createCandidateInterview(candidateId, { comment, interview_date, interview_time }),
		onSuccess: (created, variables) => {
			toast.success("Interview added", {
				description: "Interview has been saved with backend timestamp.",
			})

			const newInterview: InterviewItem = {
				id: created.id,
				comment: created.comment ?? null,
				created_at: created.created_at ?? null,
				updated_at: created.updated_at ?? null,
				interview_date: created.interview_date ?? null,
				interview_time: created.interview_time ?? null,
				round: created.round ?? null,
			}

			setEditCandidate((current) => {
				if (!current || current.id !== variables.candidateId) return current
				return {
					...current,
					interviews: [newInterview, ...(current.interviews ?? [])],
				}
			})

			setViewCandidate((current) => {
				if (!current || current.id !== variables.candidateId) return current
				return {
					...current,
					interviews: [newInterview, ...(current.interviews ?? [])],
				}
			})

			// Invalidate and refetch candidate lists so UI reflects new interviews
			void queryClient.invalidateQueries({ queryKey: ["candidates"] })
			void queryClient.refetchQueries({ queryKey: ["candidates"], exact: false })
		},
		onError: (error) => {
			toast.error("Add interview failed", {
				description: getApiErrorMessage(error),
			})
		},
	})

	const updateCommentMutation = useMutation({
		mutationFn: ({
			candidateId,
			commentId,
			comment,
			interview_date,
			interview_time,
		}: {
			candidateId: number
			commentId: number
			comment: string
			interview_date?: string | null
			interview_time?: string | null
		}) => updateCandidateInterview(candidateId, commentId, { comment, interview_date, interview_time }),
		onMutate: ({ commentId }) => {
			setUpdatingCommentId(commentId)
		},
		onSuccess: (updated, variables) => {
			toast.success("Interview updated", {
				description: "Interview details were saved successfully.",
			})

			const patchInterviews = (interviews: InterviewItem[] | undefined) =>
				(interviews ?? []).map((iv) =>
					iv.id === variables.commentId
						? {
							...iv,
							comment: updated.comment ?? null,
							interview_date: updated.interview_date ?? null,
							interview_time: updated.interview_time ?? null,
							updated_at: updated.updated_at ?? null,
						}
						: iv
				)

			setEditCandidate((current) => {
				if (!current || current.id !== variables.candidateId) return current
				return { ...current, interviews: patchInterviews(current.interviews) }
			})

			setViewCandidate((current) => {
				if (!current || current.id !== variables.candidateId) return current
				return { ...current, interviews: patchInterviews(current.interviews) }
			})

			// Invalidate and refetch candidate lists so edited interviews are visible
			void queryClient.invalidateQueries({ queryKey: ["candidates"] })
			void queryClient.refetchQueries({ queryKey: ["candidates"], exact: false })
		},
		onError: (error) => {
			toast.error("Update interview failed", {
				description: getApiErrorMessage(error),
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

			<Card>
				<CardHeader>
					<CardTitle>Requirement Context</CardTitle>
					<CardDescription>
						Candidates are shown for the selected requirement.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
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
								{requirementsQuery.data?.filter(r => r.is_active).map((requirement) => (
									<SelectItem
										key={requirement.id}
										value={requirement.id.toString()}
									>
										{requirement.title}
									</SelectItem>
								))}
								{showInactiveRequirements && requirementsQuery.data?.some(r => !r.is_active) && (
									<>
										<div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
											Inactive
										</div>
										{requirementsQuery.data?.filter(r => !r.is_active).map((requirement) => (
											<SelectItem
												key={requirement.id}
												value={requirement.id.toString()}
												className="text-muted-foreground"
											>
												{requirement.title} (inactive)
											</SelectItem>
										))}
									</>
								)}
							</SelectContent>
						</Select>
					</Field>

					<div className="flex items-center gap-2">
						<Switch
							id="show-inactive"
							size="sm"
							checked={showInactiveRequirements}
							onCheckedChange={(checked) => {
								setShowInactiveRequirements(checked)
								// If currently selected requirement becomes hidden, reset selection
								if (!checked && isSelectedRequirementInactive) {
									setSelectedRequirementId(null)
								}
							}}
						/>
						<label htmlFor="show-inactive" className="text-sm text-muted-foreground cursor-pointer select-none">
							Show inactive requirements
						</label>
					</div>

					{isSelectedRequirementInactive && (
						<Alert>
							<AlertCircleIcon className="size-4" />
							<AlertTitle>Inactive requirement</AlertTitle>
							<AlertDescription>
								This requirement is inactive. Candidate statuses are read-only.
							</AlertDescription>
						</Alert>
					)}
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
												{isSelectedRequirementInactive ? (
													(() => {
														const status = candidate.requirement_status ?? "not_applied"
														const styleMap: Record<string, string> = {
															not_applied: "bg-zinc-100/60 text-zinc-500 border-zinc-200 dark:bg-zinc-800/40 dark:text-zinc-400 dark:border-zinc-700",
															new:         "bg-blue-100/60 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800",
															processing:  "bg-amber-100/60 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800",
															rejected:    "bg-red-100/60 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800",
															hired:       "bg-emerald-100/60 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800",
														}
														return (
															<span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${styleMap[status] ?? styleMap.not_applied}`}>
																{status.replace("_", " ")}
															</span>
														)
													})()
												) : (
												<Select
													value={candidate.requirement_status ?? "not_applied"}
													onValueChange={(value) => {
														if (activeRequirementId === null) return
														if (
															value !== "not_applied" &&
															value !== "new" &&
															value !== "processing" &&
															value !== "rejected" &&
															value !== "hired"
														) {
															return
														}
														updateRequirementStatusMutation.mutate({
															requirementId: activeRequirementId,
															candidateId: candidate.id,
															status: value,
														})
													}}
													disabled={updateRequirementStatusMutation.isPending}
												>
													<SelectTrigger className="w-32">
														<SelectValue placeholder="Set status" />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="not_applied">Not applied</SelectItem>
														<SelectItem value="new">New</SelectItem>
														<SelectItem value="processing">Processing</SelectItem>
														<SelectItem value="rejected">Rejected</SelectItem>
														<SelectItem value="hired">Hired</SelectItem>
													</SelectContent>
												</Select>
												)}
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
												{!isSelectedRequirementInactive && (
												<Button
													type="button"
													variant="outline"
													size="sm"
													onClick={() => setEditCandidate(candidate)}
												>
													<PencilIcon />
													Edit
												</Button>
												)}
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
				isReadOnly={isSelectedRequirementInactive}
				onEdit={(candidate) => {
					setViewCandidate(null)
					setEditCandidate(candidate)
				}}
			/>

			<CandidateEditModal
				key={editCandidate?.id ?? -1}
				candidate={editCandidate}
				isAddingComment={addCommentMutation.isPending}
				updatingCommentId={updatingCommentId}
				onClose={() => setEditCandidate(null)}
				onAddComment={async (candidateId, comment, interview_date, interview_time) => {
					return addCommentMutation.mutateAsync({
						candidateId,
						comment,
						interview_date,
						interview_time,
					})
				}}
				onUpdateComment={async (candidateId, commentId, comment, interview_date, interview_time) => {
					return updateCommentMutation.mutateAsync({
						candidateId,
						commentId,
						comment,
						interview_date,
						interview_time,
					})
				}}
			/>
		</div>
	)
}
