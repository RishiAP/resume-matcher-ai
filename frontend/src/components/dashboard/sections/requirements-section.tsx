"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Controller, useFieldArray, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
	AlertCircleIcon,
	CirclePlusIcon,
	Loader2Icon,
	Trash2Icon,
} from "lucide-react"
import { useState, type KeyboardEvent } from "react"
import { z } from "zod"

import {
	createRequirement,
	extractRequirementFromText,
	getApiErrorMessage,
	listRequirements,
	type RequirementCreate,
	type RequirementRead,
	updateRequirement,
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
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import {
	MutationState,
	Notification,
	SkillsPreview,
	requirementsQueryKey,
	toOptionalFloat,
	toOptionalInt,
	type ToastState,
} from "@/components/dashboard/sections/shared"

const requirementSchema = z
	.object({
		title: z
			.string()
			.trim()
			.min(3, "Role title should be at least 3 characters."),
		requiredSkills: z
			.array(
				z.object({
					name: z.string().trim().min(1, "Skill tag is required."),
					minExperienceYears: z
						.string()
						.optional()
						.refine((value) => !value || !Number.isNaN(Number(value)), {
							message: "Min skill experience must be numeric.",
						}),
				})
			)
			.min(1, "Add at least one required skill."),
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
		minCtc: z
			.string()
			.optional()
			.refine((value) => !value || !Number.isNaN(Number(value)), {
				message: "Min CTC must be numeric.",
			}),
		maxCtc: z
			.string()
			.optional()
			.refine((value) => !value || !Number.isNaN(Number(value)), {
				message: "Max CTC must be numeric.",
			}),
		notes: z.string().optional(),
		qualification: z.string().optional(),
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
	.refine(
		(value) => {
			const min = toOptionalFloat(value.minCtc)
			const max = toOptionalFloat(value.maxCtc)

			if (typeof min === "number" && typeof max === "number") {
				return max >= min
			}

			return true
		},
		{
			message: "Max CTC should be greater than or equal to min CTC.",
			path: ["maxCtc"],
		}
	)

type RequirementValues = z.infer<typeof requirementSchema>

const requirementExtractionSchema = z.object({
	text: z
		.string()
		.trim()
		.min(40, "Add at least 40 characters of requirement context."),
})

type RequirementExtractionValues = z.infer<typeof requirementExtractionSchema>

const requirementExampleValues: RequirementValues = {
	title: "Senior Frontend Developer",
	requiredSkills: [
		{ name: "react", minExperienceYears: "3" },
		{ name: "next.js", minExperienceYears: "2" },
		{ name: "typescript", minExperienceYears: "3" },
		{ name: "tailwind css", minExperienceYears: "1" },
		{ name: "zod", minExperienceYears: "" },
	],
	minExperience: "3",
	maxExperience: "6",
	location: "Bengaluru / Remote",
	minCtc: "18",
	maxCtc: "32",
	notes:
		"Must have strong component architecture, API integration, and mentor-level code review skills.",
	qualification: "B.Tech in CS or related; fintech domain experience preferred",
}

const emptyRequirementValues: RequirementValues = {
	title: "",
	requiredSkills: [],
	minExperience: "",
	maxExperience: "",
	location: "",
	minCtc: "",
	maxCtc: "",
	notes: "",
	qualification: "",
}

export function RequirementsSection() {
	const queryClient = useQueryClient()
	const [notification, setNotification] = useState<ToastState | null>(null)
	const [editingRequirementId, setEditingRequirementId] = useState<number | null>(
		null
	)

	const requirementsQuery = useQuery({
		queryKey: requirementsQueryKey,
		queryFn: listRequirements,
		// Always refresh the requirements list when this component mounts
		refetchOnMount: "always",
	})

	const form = useForm<RequirementValues>({
		resolver: zodResolver(requirementSchema),
		defaultValues: emptyRequirementValues,
	})

	const extractForm = useForm<RequirementExtractionValues>({
		resolver: zodResolver(requirementExtractionSchema),
		defaultValues: {
			text: "",
		},
	})

	const requirementSkillFields = useFieldArray({
		control: form.control,
		name: "requiredSkills",
	})

	const resetRequirementForm = () => {
		form.reset(emptyRequirementValues)
		requirementSkillFields.replace([])
		setEditingRequirementId(null)
	}

	const setRequirementFormValues = (requirement: RequirementRead) => {
		form.reset({
			title: requirement.title ?? "",
			requiredSkills:
				requirement.skills?.map((skill) => ({
					name: skill.name,
					minExperienceYears:
						skill.min_experience_years != null
							? String(skill.min_experience_years)
							: "",
				})) ?? [],
			minExperience:
				requirement.min_experience != null
					? String(requirement.min_experience)
					: "",
			maxExperience:
				requirement.max_experience != null
					? String(requirement.max_experience)
					: "",
			location: requirement.location ?? "",
			minCtc: requirement.min_ctc != null ? String(requirement.min_ctc) : "",
			maxCtc: requirement.max_ctc != null ? String(requirement.max_ctc) : "",
			notes: requirement.notes ?? "",
			qualification: requirement.qualification ?? "",
		})
		setEditingRequirementId(requirement.id)
	}

	const handleRequiredSkillEnter =
		(index: number) => (event: KeyboardEvent<HTMLInputElement>) => {
			if (event.key !== "Enter") {
				return
			}

			event.preventDefault()

			const rows = form.getValues("requiredSkills") ?? []
			const current = rows[index]
			const hasCurrentValue = Boolean(
				current?.name?.trim() || current?.minExperienceYears?.trim()
			)
			if (!hasCurrentValue) {
				return
			}

			const isLastRow = index === requirementSkillFields.fields.length - 1
			if (isLastRow) {
				requirementSkillFields.append({
					name: "",
					minExperienceYears: "",
				})
			}

			const nextIndex = index + 1
			requestAnimationFrame(() => {
				form.setFocus(`requiredSkills.${nextIndex}.name`)
			})
		}

	const createRequirementMutation = useMutation({
		mutationFn: (payload: RequirementCreate) => createRequirement(payload),
		onSuccess: (newRequirement) => {
			setNotification({
				type: "success",
				title: "Requirement created",
				message: `Requirement #${newRequirement.id} is ready for matching.`,
			})
			resetRequirementForm()
			// Invalidate and refetch requirement lists so UI reflects changes
			void queryClient.invalidateQueries({ queryKey: requirementsQueryKey })
			void queryClient.refetchQueries({ queryKey: requirementsQueryKey, exact: false })
		},
		onError: (error) => {
			setNotification({
				type: "error",
				title: "Requirement creation failed",
				message: getApiErrorMessage(error),
			})
		},
	})

	const updateRequirementMutation = useMutation({
		mutationFn: ({
			requirementId,
			payload,
		}: {
			requirementId: number
			payload: RequirementCreate
		}) => updateRequirement(requirementId, payload),
		onSuccess: (updatedRequirement) => {
			setNotification({
				type: "success",
				title: "Requirement updated",
				message: `Requirement #${updatedRequirement.id} has been updated.`,
			})
			resetRequirementForm()
			// Invalidate and refetch requirement lists so UI reflects changes
			void queryClient.invalidateQueries({ queryKey: requirementsQueryKey })
			void queryClient.refetchQueries({ queryKey: requirementsQueryKey, exact: false })
		},
		onError: (error) => {
			setNotification({
				type: "error",
				title: editingRequirementId ? "Requirement update failed" : "Requirement creation failed",
				message: getApiErrorMessage(error),
			})
		},
	})

	const extractRequirementMutation = useMutation({
		mutationFn: (payload: { text: string }) => extractRequirementFromText(payload),
		onSuccess: (requirement) => {
			setEditingRequirementId(null)
			form.reset({
				title: requirement.title ?? "",
				requiredSkills:
					requirement.skills?.map((skill) => ({
						name: skill.name,
						minExperienceYears:
							skill.min_experience_years != null
								? String(skill.min_experience_years)
								: "",
					})) ?? [],
				minExperience:
					requirement.min_experience != null
						? String(requirement.min_experience)
						: "",
				maxExperience:
					requirement.max_experience != null
						? String(requirement.max_experience)
						: "",
				location: requirement.location ?? "",
				minCtc: requirement.min_ctc != null ? String(requirement.min_ctc) : "",
				maxCtc: requirement.max_ctc != null ? String(requirement.max_ctc) : "",
				notes: requirement.notes ?? "",
				qualification: requirement.qualification ?? "",
			})

			setNotification({
				type: "success",
				title: "Requirement extracted",
				message:
					"The requirement form has been prefilled. Review and save it below.",
			})
		},
		onError: (error) => {
			setNotification({
				type: "error",
				title: "Extraction failed",
				message: getApiErrorMessage(error),
			})
		},
	})

	const isSavingRequirement =
		createRequirementMutation.isPending || updateRequirementMutation.isPending

	const sortedRequirements = [...(requirementsQuery.data ?? [])].sort((left, right) => {
		const leftTime = left.created_at ? new Date(left.created_at).getTime() : 0
		const rightTime = right.created_at ? new Date(right.created_at).getTime() : 0

		if (rightTime !== leftTime) {
			return rightTime - leftTime
		}

		return right.id - left.id
	})

	return (
		<div className="space-y-6">
			<Notification
				state={notification}
				onDismiss={() => setNotification(null)}
			/>

			<Card>
				<CardHeader>
					<CardTitle>Requirement Library</CardTitle>
					<CardDescription>
						{sortedRequirements.length} active requirement profiles.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{requirementsQuery.isLoading ? (
						<MutationState
							isLoading
							pendingLabel="Loading requirements"
							idleLabel=""
						/>
					) : requirementsQuery.isError ? (
						<Alert variant="destructive">
							<AlertCircleIcon className="size-4" />
							<AlertTitle>Unable to load requirements</AlertTitle>
							<AlertDescription>
								{getApiErrorMessage(requirementsQuery.error)}
							</AlertDescription>
						</Alert>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Requirement #</TableHead>
									<TableHead>Role</TableHead>
									<TableHead>Skills</TableHead>
									<TableHead>Experience</TableHead>
									<TableHead>Location</TableHead>
									<TableHead>Min / Max CTC</TableHead>
									<TableHead>Qualification</TableHead>
									<TableHead className="text-right">Action</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{sortedRequirements.map((requirement) => (
									<TableRow key={requirement.id}>
										<TableCell className="font-medium">#{requirement.id}</TableCell>
										<TableCell className="font-medium">{requirement.title}</TableCell>
										<TableCell>
											<SkillsPreview
												skills={
													requirement.skills?.map((skill) =>
														skill.min_experience_years != null
															? `${skill.name} (${skill.min_experience_years}+y)`
															: skill.name
													) ?? []
												}
												keyPrefix={`requirement-${requirement.id}`}
											/>
										</TableCell>
										<TableCell>
											{requirement.min_experience ?? "-"} - {" "}
											{requirement.max_experience ?? "-"}
										</TableCell>
										<TableCell>{requirement.location ?? "-"}</TableCell>
										<TableCell>
											{requirement.min_ctc ?? "-"} - {requirement.max_ctc ?? "-"}
										</TableCell>
										<TableCell>
											{requirement.qualification?.slice(0, 80) || "-"}
										</TableCell>
										<TableCell className="text-right">
											<div className="flex justify-end gap-2">
												<Button
													type="button"
													variant="ghost"
													size="sm"
													onClick={() => {
														setRequirementFormValues(requirement)
													}}
												>
													Edit
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

			<Card>
				<CardHeader>
					<CardTitle>Extract Requirement From Text</CardTitle>
					<CardDescription>
						Paste a JD or client requirement note and use AI to prefill the
						structured requirement form.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form
						className="space-y-4"
						onSubmit={extractForm.handleSubmit((values) => {
							extractRequirementMutation.mutate({ text: values.text })
						})}
					>
						<Controller
							name="text"
							control={extractForm.control}
							render={({ field, fieldState }) => (
								<Field data-invalid={fieldState.invalid}>
									<FieldLabel htmlFor="requirement-source-text">
										Requirement Text
									</FieldLabel>
									<Textarea
										{...field}
										id="requirement-source-text"
										className="min-h-40"
										aria-invalid={fieldState.invalid}
										placeholder="Paste the role description, must-have skills, experience band, location, compensation, and notes..."
									/>
									<FieldDescription>
										The extracted values will populate the form below for review.
									</FieldDescription>
									<FieldError errors={[fieldState.error]} />
								</Field>
							)}
						/>

						<div className="flex flex-wrap items-center gap-3">
							<Button type="submit" disabled={extractRequirementMutation.isPending}>
								{extractRequirementMutation.isPending && (
									<Loader2Icon className="animate-spin" />
								)}
								Extract and Prefill
							</Button>
							<Button
								type="button"
								variant="outline"
								onClick={() => {
									extractForm.reset({ text: "" })
								}}
							>
								Clear Text
							</Button>
							<MutationState
								isLoading={extractRequirementMutation.isPending}
								pendingLabel="Extracting requirement"
								idleLabel=""
							/>
						</div>
					</form>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>
						{editingRequirementId
							? `Edit Requirement #${editingRequirementId}`
							: "Create Requirement"}
					</CardTitle>
					<CardDescription>
						Define a role profile for AI-powered candidate matching.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form
						className="space-y-4"
						onSubmit={form.handleSubmit((values) => {
							const payload: RequirementCreate = {
								title: values.title.trim(),
								skills: values.requiredSkills
									.map((skill) => ({
										name: skill.name.trim().toLowerCase(),
										min_experience_years:
											toOptionalFloat(skill.minExperienceYears) ?? null,
									}))
									.filter((skill) => skill.name.length > 0),
								min_experience: toOptionalInt(values.minExperience) ?? null,
								max_experience: toOptionalInt(values.maxExperience) ?? null,
								location: values.location?.trim() || null,
								min_ctc: toOptionalFloat(values.minCtc) ?? null,
								max_ctc: toOptionalFloat(values.maxCtc) ?? null,
								notes: values.notes?.trim() || null,
								qualification: values.qualification?.trim() || null,
							}

							if (editingRequirementId) {
								updateRequirementMutation.mutate({
									requirementId: editingRequirementId,
									payload,
								})
								return
							}

							createRequirementMutation.mutate(payload)
						})}
					>
						<FieldSet>
							<FieldLegend>Role Details</FieldLegend>
							<FieldDescription>
								Add as much context as possible to improve ranking quality.
							</FieldDescription>
							<FieldGroup className="grid gap-4 lg:grid-cols-2">
								<Controller
									name="title"
									control={form.control}
									render={({ field, fieldState }) => (
										<Field data-invalid={fieldState.invalid}>
											<FieldLabel htmlFor="req-title">Role Title</FieldLabel>
											<Input
												{...field}
												id="req-title"
												aria-invalid={fieldState.invalid}
												placeholder="e.g. Senior Backend Engineer"
											/>
											<FieldError errors={[fieldState.error]} />
										</Field>
									)}
								/>

								<Controller
									name="requiredSkills"
									control={form.control}
									render={({ field, fieldState }) => (
										<Field data-invalid={fieldState.invalid}>
											<FieldLabel htmlFor="req-skills">Required Skills</FieldLabel>
											<div id="req-skills" className="space-y-3">
												{requirementSkillFields.fields.map((row, index) => (
													<div
														key={row.id}
														className="flex flex-wrap items-center gap-2 rounded-md border border-border/70 bg-muted/20 p-2"
													>
														<Controller
															name={`requiredSkills.${index}.name` as const}
															control={form.control}
															render={({ field: nameField }) => (
																<Input
																	{...nameField}
																	onKeyDown={handleRequiredSkillEnter(index)}
																	placeholder="Skill tag (e.g. react)"
																	className="h-8 min-w-40 flex-1"
																/>
															)}
														/>
														<Controller
															name={`requiredSkills.${index}.minExperienceYears` as const}
															control={form.control}
															render={({ field: experienceField }) => (
																<Input
																	{...experienceField}
																	onKeyDown={handleRequiredSkillEnter(index)}
																	inputMode="decimal"
																	placeholder="Experience in years (optional)"
																	className="h-8 w-44"
																/>
															)}
														/>
														<Button
															type="button"
															size="sm"
															variant="outline"
															onClick={() => requirementSkillFields.remove(index)}
														>
															<Trash2Icon />
														</Button>
													</div>
												))}

												<Button
													type="button"
													variant="outline"
													size="sm"
													onClick={() => {
														requirementSkillFields.append({
															name: "",
															minExperienceYears: "",
														})
													}}
												>
													<CirclePlusIcon />
													Add Skill Tag
												</Button>

												{(field.value ?? []).length ? (
													<div className="flex flex-wrap gap-1">
														{(field.value ?? [])
															.map((item) => {
																const skillName = item.name?.trim().toLowerCase()
																if (!skillName) {
																	return null
																}
																const years = toOptionalFloat(item.minExperienceYears)
																return years != null
																	? `${skillName} (${years}+y)`
																	: skillName
															})
															.filter((item): item is string => Boolean(item))
															.map((item) => (
																<Badge key={`req-skill-preview-${item}`} variant="outline">
																	{item}
																</Badge>
															))}
													</div>
												) : null}
											</div>
											<FieldDescription>
												Add each required skill as a tag, with optional minimum
												years per skill.
											</FieldDescription>
											<FieldError errors={[fieldState.error]} />
										</Field>
									)}
								/>

								<Controller
									name="minExperience"
									control={form.control}
									render={({ field, fieldState }) => (
										<Field data-invalid={fieldState.invalid}>
											<FieldLabel htmlFor="req-min-exp">Min Experience</FieldLabel>
											<Input
												{...field}
												id="req-min-exp"
												inputMode="numeric"
												aria-invalid={fieldState.invalid}
												placeholder="e.g. 3"
											/>
											<FieldError errors={[fieldState.error]} />
										</Field>
									)}
								/>

								<Controller
									name="maxExperience"
									control={form.control}
									render={({ field, fieldState }) => (
										<Field data-invalid={fieldState.invalid}>
											<FieldLabel htmlFor="req-max-exp">Max Experience</FieldLabel>
											<Input
												{...field}
												id="req-max-exp"
												inputMode="numeric"
												aria-invalid={fieldState.invalid}
												placeholder="e.g. 8"
											/>
											<FieldError errors={[fieldState.error]} />
										</Field>
									)}
								/>

								<Controller
									name="minCtc"
									control={form.control}
									render={({ field, fieldState }) => (
										<Field data-invalid={fieldState.invalid}>
											<FieldLabel htmlFor="req-min-ctc">Min CTC</FieldLabel>
											<Input
												{...field}
												id="req-min-ctc"
												inputMode="decimal"
												aria-invalid={fieldState.invalid}
												placeholder="e.g. 18.5"
											/>
											<FieldError errors={[fieldState.error]} />
										</Field>
									)}
								/>

								<Controller
									name="maxCtc"
									control={form.control}
									render={({ field, fieldState }) => (
										<Field data-invalid={fieldState.invalid}>
											<FieldLabel htmlFor="req-max-ctc">Max CTC</FieldLabel>
											<Input
												{...field}
												id="req-max-ctc"
												inputMode="decimal"
												aria-invalid={fieldState.invalid}
												placeholder="e.g. 32"
											/>
											<FieldError errors={[fieldState.error]} />
										</Field>
									)}
								/>

								<Controller
									name="qualification"
									control={form.control}
									render={({ field, fieldState }) => (
										<Field data-invalid={fieldState.invalid}>
											<FieldLabel htmlFor="req-qualification">Qualification</FieldLabel>
											<Input
												{...field}
												id="req-qualification"
												aria-invalid={fieldState.invalid}
												placeholder="e.g. B.Tech in CS or related"
											/>
											<FieldError errors={[fieldState.error]} />
										</Field>
									)}
								/>

								<Controller
									name="location"
									control={form.control}
									render={({ field, fieldState }) => (
										<Field data-invalid={fieldState.invalid}>
											<FieldLabel htmlFor="req-location">Location</FieldLabel>
											<Input
												{...field}
												id="req-location"
												aria-invalid={fieldState.invalid}
												placeholder="e.g. Remote / Bengaluru"
											/>
											<FieldError errors={[fieldState.error]} />
										</Field>
									)}
								/>
							</FieldGroup>

							<Controller
								name="notes"
								control={form.control}
								render={({ field, fieldState }) => (
									<Field data-invalid={fieldState.invalid}>
										<FieldLabel htmlFor="req-notes">Notes</FieldLabel>
										<Textarea
											{...field}
											id="req-notes"
											className="min-h-24"
											aria-invalid={fieldState.invalid}
											placeholder="e.g. Must have fintech domain experience and API design ownership"
										/>
										<FieldError errors={[fieldState.error]} />
									</Field>
								)}
							/>
						</FieldSet>

						<div className="flex flex-wrap items-center gap-3">
							<Button type="submit" disabled={isSavingRequirement}>
								{isSavingRequirement && (
									<Loader2Icon className="animate-spin" />
								)}
								{editingRequirementId ? "Update Requirement" : "Save Requirement"}
							</Button>
							<Button
								type="button"
								variant="outline"
								onClick={() => {
									setEditingRequirementId(null)
									form.reset(requirementExampleValues)
								}}
							>
								Load Example Values
							</Button>
							{editingRequirementId ? (
								<Button
									type="button"
									variant="outline"
									onClick={() => {
										resetRequirementForm()
									}}
								>
									Cancel Edit
								</Button>
							) : null}
							<MutationState
								isLoading={isSavingRequirement}
								pendingLabel={
									editingRequirementId
										? "Updating requirement"
										: "Saving requirement"
								}
								idleLabel=""
							/>
						</div>
					</form>
				</CardContent>
			</Card>

		</div>
	)
}
