"use client"

import { useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2Icon } from "lucide-react"
import { z } from "zod"

import {
	getApiErrorMessage,
	getJobsOverview,
	listRequirements,
	uploadResumeByUrl,
	uploadResumeFile,
	uploadResumeFiles,
	uploadResumeUrlsBulk,
	type RequirementRead,
	type BulkUploadEnqueueResponse,
	type UploadEnqueueResponse,
} from "@/lib/api-client"
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
	FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
	QueueStatusBanner,
	Notification,
	MutationState,
	jobsQueryKey,
	requirementsQueryKey,
	hasSupportedResumeExtension,
	isValidHttpUrl,
	parseResumeUrls,
	type ToastState,
} from "@/components/dashboard/sections/shared"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

const requirementSelectionSchema = z.object({
	requirementId: z
		.number({
			message: "Please select a requirement before uploading resumes.",
		})
		.int()
		.positive("Please select a requirement before uploading resumes."),
})

const uploadSingleFileSchema = z.object({
	file: z
		.custom<File>((value) => value instanceof File, {
			message: "Please choose a resume file.",
		})
		.refine(
			(value) => hasSupportedResumeExtension(value.name),
			"Supported formats: PDF, DOC, DOCX."
		),
})

type UploadSingleFileValues = z.infer<typeof uploadSingleFileSchema>

const uploadBulkFileSchema = z.object({
	files: z
		.array(z.custom<File>((value) => value instanceof File))
		.min(1, "Select at least one resume file.")
		.refine(
			(files) => files.every((file) => hasSupportedResumeExtension(file.name)),
			"Every file must be PDF, DOC, or DOCX."
		),
})

type UploadBulkFileValues = z.infer<typeof uploadBulkFileSchema>

const uploadSingleUrlSchema = z.object({
	url: z
		.string()
		.trim()
		.min(1, "URL is required.")
		.refine((value) => isValidHttpUrl(value), "Enter a valid URL."),
})

type UploadSingleUrlValues = z.infer<typeof uploadSingleUrlSchema>

const uploadBulkUrlSchema = z.object({
	urlsText: z
		.string()
		.min(1, "Add at least one URL.")
		.refine((value) => parseResumeUrls(value).length > 0, {
			message: "Add at least one URL.",
		})
		.refine(
			(value) => parseResumeUrls(value).every((url) => isValidHttpUrl(url)),
			"Enter one valid URL per line."
		),
})

type UploadBulkUrlValues = z.infer<typeof uploadBulkUrlSchema>

export function ResumeIngestionSection() {
	const queryClient = useQueryClient()
	const [notification, setNotification] = useState<ToastState | null>(null)
	const [selectedRequirementId, setSelectedRequirementId] =
		useState<number | null>(null)
	const [bindToRequirement, setBindToRequirement] = useState<boolean>(true)
	const [requirementError, setRequirementError] = useState<string | null>(null)
	const singleFileInputRef = useRef<HTMLInputElement | null>(null)
	const bulkFileInputRef = useRef<HTMLInputElement | null>(null)

	const requirementsQuery = useQuery<RequirementRead[]>({
		queryKey: requirementsQueryKey,
		queryFn: listRequirements,
	})

	const activeRequirementId =
		selectedRequirementId ?? requirementsQuery.data?.[0]?.id ?? null

	const jobsQuery = useQuery({
		queryKey: jobsQueryKey,
		queryFn: getJobsOverview,
		refetchInterval: 5_000,
	})

	const singleFileForm = useForm<UploadSingleFileValues>({
		resolver: zodResolver(uploadSingleFileSchema),
	})

	const bulkFileForm = useForm<UploadBulkFileValues>({
		resolver: zodResolver(uploadBulkFileSchema),
		defaultValues: {
			files: [],
		},
	})

	const singleUrlForm = useForm<UploadSingleUrlValues>({
		resolver: zodResolver(uploadSingleUrlSchema),
		defaultValues: {
			url: "",
		},
	})

	const bulkUrlForm = useForm<UploadBulkUrlValues>({
		resolver: zodResolver(uploadBulkUrlSchema),
		defaultValues: {
			urlsText: "",
		},
	})

	const onUploadSuccess = (
		title: string,
		response: UploadEnqueueResponse | BulkUploadEnqueueResponse
	) => {
		if ("rejected" in response) {
			setNotification({
				type: "success",
				title,
				message: `Accepted ${response.accepted} resumes, rejected ${response.rejected}.`,
			})
		} else {
			setNotification({
				type: "success",
				title,
				message: `${response.accepted} resume queued for processing.`,
			})
		}

		void queryClient.invalidateQueries({ queryKey: jobsQueryKey })
		void queryClient.invalidateQueries({ queryKey: ["candidates"] })
	}

	const uploadSingleFileMutation = useMutation({
		mutationFn: async (values: UploadSingleFileValues) => {
			if (!(values.file instanceof File)) {
				throw new Error("Please choose a file.")
			}

			if (bindToRequirement && activeRequirementId === null) {
				throw new Error("Please select a requirement before uploading resumes.")
			}

			const reqId = bindToRequirement ? (activeRequirementId ?? undefined) : undefined
			return uploadResumeFile(values.file, reqId)
		},
		onSuccess: (response) => {
			onUploadSuccess("Single resume upload queued", response)
			singleFileForm.reset()
			if (singleFileInputRef.current) {
				singleFileInputRef.current.value = ""
			}
		},
		onError: (error) => {
			setNotification({
				type: "error",
				title: "Single file upload failed",
				message: getApiErrorMessage(error),
			})
		},
	})

	const uploadBulkFileMutation = useMutation({
		mutationFn: (values: UploadBulkFileValues) => {
			if (bindToRequirement && activeRequirementId === null) {
				throw new Error("Please select a requirement before uploading resumes.")
			}
			const reqId = bindToRequirement ? (activeRequirementId ?? undefined) : undefined
			return uploadResumeFiles(values.files, reqId)
		},
		onSuccess: (response) => {
			onUploadSuccess("Bulk file upload queued", response)
			bulkFileForm.reset({ files: [] })
			if (bulkFileInputRef.current) {
				bulkFileInputRef.current.value = ""
			}
		},
		onError: (error) => {
			setNotification({
				type: "error",
				title: "Bulk file upload failed",
				message: getApiErrorMessage(error),
			})
		},
	})

	const uploadSingleUrlMutation = useMutation({
		mutationFn: (values: UploadSingleUrlValues) => {
			if (bindToRequirement && activeRequirementId === null) {
				throw new Error("Please select a requirement before uploading resumes.")
			}
			const reqId = bindToRequirement ? (activeRequirementId ?? undefined) : undefined
			return uploadResumeByUrl({
				url: values.url,
				requirement_id: reqId,
			})
		},
		onSuccess: (response) => {
			onUploadSuccess("Resume URL queued", response)
			singleUrlForm.reset({ url: "" })
		},
		onError: (error) => {
			setNotification({
				type: "error",
				title: "URL upload failed",
				message: getApiErrorMessage(error),
			})
		},
	})

	const uploadBulkUrlMutation = useMutation({
		mutationFn: (values: UploadBulkUrlValues) => {
			if (bindToRequirement && activeRequirementId === null) {
				throw new Error("Please select a requirement before uploading resumes.")
			}
			const reqId = bindToRequirement ? (activeRequirementId ?? undefined) : undefined
			return uploadResumeUrlsBulk({
				urls: parseResumeUrls(values.urlsText),
				requirement_id: reqId,
			})
		},
		onSuccess: (response) => {
			onUploadSuccess("Bulk URL upload queued", response)
			bulkUrlForm.reset({ urlsText: "" })
		},
		onError: (error) => {
			setNotification({
				type: "error",
				title: "Bulk URL upload failed",
				message: getApiErrorMessage(error),
			})
		},
	})

	const validateRequirement = () => {
		// If there are no requirements at all, block uploads and show a clear message.
		if (!requirementsQuery.data?.length) {
			setRequirementError(
				"Create at least one requirement before uploading resumes."
			)
			return null
		}

		// If nothing is selected yet, show the generic required message.
		if (activeRequirementId === null) {
			setRequirementError(
				"Please select a requirement before uploading resumes."
			)
			return null
		}

		const result = requirementSelectionSchema.safeParse({
			requirementId: activeRequirementId,
		})

		if (!result.success) {
			const firstError = Array.isArray(result.error?.issues)
				? result.error.issues[0]
				: undefined
			const message =
				firstError?.message ??
				"Please select a requirement before uploading resumes."
			setRequirementError(message)
			return null
		}

		setRequirementError(null)
		return result.data.requirementId
	}

	return (
		<div className="space-y-6">
			<Notification
				state={notification}
				onDismiss={() => setNotification(null)}
			/>
			<QueueStatusBanner jobs={jobsQuery.data} />

			<Card>
				<CardHeader>
					<CardTitle>Resume Binding</CardTitle>
					<CardDescription>
						Control whether uploads are associated to a requirement.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Field orientation="responsive">
						<div className="flex items-center justify-between gap-4">
							<div>
								<FieldLabel>Bind uploads to requirement <Switch checked={bindToRequirement} onCheckedChange={(val) => setBindToRequirement(Boolean(val))} size="sm" /></FieldLabel>
								<FieldDescription>
									When enabled, uploads are associated to the selected requirement and candidates will be marked <span className="font-medium">new</span>.
								</FieldDescription>
							</div>
						</div>
					</Field>

					{bindToRequirement ? (
						<Field orientation="responsive">
							<FieldLabel>Requirement</FieldLabel>
							<FieldDescription>
								Required. Choose the role candidates are applying for.
							</FieldDescription>
							<Select
								value={
									activeRequirementId !== null
										? activeRequirementId.toString()
										: ""
								}
								onValueChange={(value) => {
									const parsed = Number(value)
									setSelectedRequirementId(Number.isFinite(parsed) ? parsed : null)
									setRequirementError(null)
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
							<FieldError
								errors={
									requirementError ? [{ message: requirementError }] : []
								}
							/>
						</Field>
					) : (
						<div className="rounded-md border border-border/60 bg-muted/10 p-3">
							<p className="text-sm text-muted-foreground">Uploads will not be associated with a requirement.</p>
						</div>
					)}
				</CardContent>
			</Card>

			<Tabs defaultValue="single-file" className="w-full">
				<TabsList variant="line" className="w-full justify-start overflow-x-auto">
					<TabsTrigger value="single-file">Single File</TabsTrigger>
					<TabsTrigger value="bulk-files">Bulk Files</TabsTrigger>
					<TabsTrigger value="single-url">Single URL</TabsTrigger>
					<TabsTrigger value="bulk-urls">Bulk URLs</TabsTrigger>
				</TabsList>

				<TabsContent value="single-file" className="pt-4">
					<Card>
						<CardHeader>
							<CardTitle>Upload One Resume</CardTitle>
							<CardDescription>
								Use for quick ad-hoc candidate imports.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<form
								className="space-y-4"
								onSubmit={singleFileForm.handleSubmit((values) => {
									const requirementId = bindToRequirement ? validateRequirement() : undefined
									if (bindToRequirement && !requirementId) return
									uploadSingleFileMutation.mutate(values)
								})}
							>
								<Controller
									name="file"
									control={singleFileForm.control}
									render={({ field, fieldState }) => (
										<Field data-invalid={fieldState.invalid}>
											<FieldLabel htmlFor="resume-single-file">
												Resume File (PDF / DOC / DOCX)
											</FieldLabel>
											<Input
												id="resume-single-file"
												ref={singleFileInputRef}
												name={field.name}
												type="file"
												accept=".pdf,.doc,.docx"
												aria-invalid={fieldState.invalid}
												disabled={!requirementsQuery.data?.length && bindToRequirement}
												onBlur={field.onBlur}
												onChange={(event) => {
													field.onChange(event.target.files?.[0])
												}}
											/>
											<FieldDescription>
												Files are queued and processed asynchronously.
											</FieldDescription>
											<FieldError errors={[fieldState.error]} />
										</Field>
									)}
								/>

								<div className="flex flex-wrap items-center gap-3">
										<Button
											type="submit"
											disabled={
												(!requirementsQuery.data?.length && bindToRequirement) ||
												uploadSingleFileMutation.isPending
											}
										>
										{uploadSingleFileMutation.isPending && (
											<Loader2Icon className="animate-spin" />
										)}
										Queue Upload
									</Button>
									<MutationState
										isLoading={uploadSingleFileMutation.isPending}
										pendingLabel="Submitting single file"
										idleLabel=""
									/>
								</div>
							</form>
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="bulk-files" className="pt-4">
					<Card>
						<CardHeader>
							<CardTitle>Bulk File Upload</CardTitle>
							<CardDescription>
								Select multiple resumes in one action.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<form
								className="space-y-4"
								onSubmit={bulkFileForm.handleSubmit((values) => {
									const requirementId = bindToRequirement ? validateRequirement() : undefined
									if (bindToRequirement && !requirementId) return
									uploadBulkFileMutation.mutate(values)
								})}
							>
								<Controller
									name="files"
									control={bulkFileForm.control}
									render={({ field, fieldState }) => (
										<Field data-invalid={fieldState.invalid}>
											<FieldLabel htmlFor="resume-bulk-files">Resume Files</FieldLabel>
											<Input
												id="resume-bulk-files"
												ref={bulkFileInputRef}
												name={field.name}
												type="file"
												multiple
												accept=".pdf,.doc,.docx"
												aria-invalid={fieldState.invalid}
													disabled={!requirementsQuery.data?.length && bindToRequirement}
												onBlur={field.onBlur}
												onChange={(event) => {
													field.onChange(Array.from(event.target.files ?? []))
												}}
											/>
											<FieldDescription>
												Upload a batch of resumes in one go.
											</FieldDescription>
											<FieldError errors={[fieldState.error]} />
										</Field>
									)}
								/>

								<div className="flex flex-wrap items-center gap-3">
										<Button
											type="submit"
											disabled={
												(!requirementsQuery.data?.length && bindToRequirement) ||
												uploadBulkFileMutation.isPending
											}
										>
										{uploadBulkFileMutation.isPending && (
											<Loader2Icon className="animate-spin" />
										)}
										Queue Batch
									</Button>
									<MutationState
										isLoading={uploadBulkFileMutation.isPending}
										pendingLabel="Submitting batch files"
										idleLabel=""
									/>
								</div>
							</form>
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="single-url" className="pt-4">
					<Card>
						<CardHeader>
							<CardTitle>Upload Resume by URL</CardTitle>
							<CardDescription>
								Link directly to externally hosted resume files.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<form
								className="space-y-4"
								onSubmit={singleUrlForm.handleSubmit((values) => {
									const requirementId = bindToRequirement ? validateRequirement() : undefined
									if (bindToRequirement && !requirementId) return
									uploadSingleUrlMutation.mutate(values)
								})}
							>
								<Controller
									name="url"
									control={singleUrlForm.control}
									render={({ field, fieldState }) => (
										<Field data-invalid={fieldState.invalid}>
											<FieldLabel htmlFor="resume-url-single">Resume URL</FieldLabel>
											<Input
												{...field}
												id="resume-url-single"
												type="url"
												placeholder="e.g. https://example.com/resume.pdf"
												aria-invalid={fieldState.invalid}
												disabled={!requirementsQuery.data?.length && bindToRequirement}
											/>
											<FieldDescription>
												URL must be publicly reachable by the backend service.
											</FieldDescription>
											<FieldError errors={[fieldState.error]} />
										</Field>
									)}
								/>

								<div className="flex flex-wrap items-center gap-3">
										<Button
											type="submit"
											disabled={
												(!requirementsQuery.data?.length && bindToRequirement) ||
												uploadSingleUrlMutation.isPending
											}
										>
										{uploadSingleUrlMutation.isPending && (
											<Loader2Icon className="animate-spin" />
										)}
										Queue URL
									</Button>
									<MutationState
										isLoading={uploadSingleUrlMutation.isPending}
										pendingLabel="Submitting URL"
										idleLabel=""
									/>
								</div>
							</form>
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="bulk-urls" className="pt-4">
					<Card>
						<CardHeader>
							<CardTitle>Bulk URL Upload</CardTitle>
							<CardDescription>
								Paste one URL per line for high-volume ingestion.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<form
								className="space-y-4"
								onSubmit={bulkUrlForm.handleSubmit((values) => {
									const requirementId = bindToRequirement ? validateRequirement() : undefined
									if (bindToRequirement && !requirementId) return
									uploadBulkUrlMutation.mutate(values)
								})}
							>
								<Controller
									name="urlsText"
									control={bulkUrlForm.control}
									render={({ field, fieldState }) => (
										<Field data-invalid={fieldState.invalid}>
											<FieldLabel htmlFor="resume-urls-bulk">Resume URLs</FieldLabel>
											<Textarea
												{...field}
												id="resume-urls-bulk"
												className="min-h-36"
												aria-invalid={fieldState.invalid}
												placeholder={[
													"e.g. https://example.com/candidate-a.pdf",
													"e.g. https://example.com/candidate-b.docx",
												].join("\n")}
												disabled={!requirementsQuery.data?.length && bindToRequirement}
											/>
											<FieldDescription>
												Enter one resume URL per line.
											</FieldDescription>
											<FieldError errors={[fieldState.error]} />
										</Field>
									)}
								/>

								<div className="flex flex-wrap items-center gap-3">
										<Button
											type="submit"
											disabled={
												(!requirementsQuery.data?.length && bindToRequirement) ||
												uploadBulkUrlMutation.isPending
											}
										>
										{uploadBulkUrlMutation.isPending && (
											<Loader2Icon className="animate-spin" />
										)}
										Queue URL Batch
									</Button>
									<MutationState
										isLoading={uploadBulkUrlMutation.isPending}
										pendingLabel="Submitting URL batch"
										idleLabel=""
									/>
								</div>
							</form>
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>
		</div>
	)
}
