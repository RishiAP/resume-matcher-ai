import axios from "axios"

import type { components, operations } from "@/generated/api-types"

// By default use same-origin (empty baseURL) and call `/api/...` routes.
// Set `NEXT_PUBLIC_API_BASE_URL` to override (e.g. http://localhost:8000).
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || ""

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30_000,
})

// Send cookies (httpOnly refresh token) by default so refresh endpoint works
apiClient.defaults.withCredentials = true

// In-memory access token (keep in JS memory to reduce XSS risk)
let accessToken: string | null = null
let refreshInFlight: Promise<TokenResponse> | null = null

type TokenListener = (token: string | null) => void
let tokenListeners: TokenListener[] = []
let tokenProvider: (() => string | null) | null = null

export function setAccessToken(token: string | null) {
  accessToken = token
  for (const l of tokenListeners) {
    try {
      l(token)
    } catch {
      // ignore listener errors
    }
  }
}

export function getAccessToken() {
  return tokenProvider ? tokenProvider() : accessToken
}

export function onAccessTokenChange(listener: TokenListener) {
  tokenListeners.push(listener)
  return () => {
    tokenListeners = tokenListeners.filter((l) => l !== listener)
  }
}

export function setTokenProvider(fn: (() => string | null) | null) {
  tokenProvider = fn
}

export function decodeJwt(token: string | null) {
  if (!token) return null
  try {
    const parts = token.split(".")
    if (parts.length < 2) return null
    const payload = parts[1]
    // base64url -> base64
    let base64 = payload.replace(/-/g, "+").replace(/_/g, "/")
    while (base64.length % 4) base64 += "="

    let jsonStr: string
    if (typeof window !== "undefined" && typeof window.atob === "function") {
      jsonStr = decodeURIComponent(
        window
          .atob(base64)
          .split("")
          .map((c) => `%${("00" + c.charCodeAt(0).toString(16)).slice(-2)}`)
          .join("")
      )
    } else {
      // Node environment fallback
      const buf = Buffer.from(base64, "base64")
      jsonStr = buf.toString("utf8")
    }

    return JSON.parse(jsonStr)
  } catch {
    return null
  }
}

// Attach access token to outgoing requests when available
apiClient.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) {
    config.headers = config.headers || {}
    config.headers["Authorization"] = `Bearer ${token}`
  }
  return config
})

export type TokenResponse = { access_token: string; token_type: "bearer" }
export type ApiUser = { id: number; username?: string; email: string; is_active?: boolean }

export async function login(identifier: string, password: string): Promise<TokenResponse> {
  const response = await apiClient.post<TokenResponse>("/api/auth/login", { identifier, password })
  setAccessToken(response.data.access_token)
  return response.data
}

export async function refreshAccessToken(): Promise<TokenResponse> {
  if (!refreshInFlight) {
    refreshInFlight = apiClient
      .post<TokenResponse>("/api/auth/refresh")
      .then((response) => {
        setAccessToken(response.data.access_token)
        return response.data
      })
      .finally(() => {
        refreshInFlight = null
      })
  }
  return refreshInFlight
}

export async function logout(): Promise<void> {
  await apiClient.post("/api/auth/logout")
  setAccessToken(null)
}

export async function getCurrentUser(): Promise<ApiUser> {
  const response = await apiClient.get<ApiUser>("/api/auth/me")
  return response.data
}

function isAuthPath(url?: string) {
  if (!url) return false
  return (
    url.includes("/api/auth/login") ||
    url.includes("/api/auth/refresh") ||
    url.includes("/api/auth/logout")
  )
}

// On 401, try refresh (cookie-based) once, then retry request.
apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    const status = error?.response?.status
    const originalConfig = error?.config as (typeof error.config & { _retry?: boolean }) | undefined
    const url = originalConfig?.url

    if (status !== 401 || !originalConfig || originalConfig._retry || isAuthPath(url)) {
      throw error
    }

    originalConfig._retry = true

    try {
      await refreshAccessToken()
      return apiClient.request(originalConfig)
    } catch {
      setAccessToken(null)
      throw error
    }
  }
)

type Schemas = components["schemas"]

export type HealthResponse = Schemas["HealthResponse"]
export type QueueJobsStatus = Schemas["QueueJobsStatus"]
export type MatchResultRead = Schemas["MatchResultRead"] & {
  requirement: {
    id: number
    title: string
  }
  status: "not_applied" | "new" | "processing" | "rejected" | "hired"
}
export type UploadEnqueueResponse = Schemas["UploadEnqueueResponse"]
export type BulkUploadEnqueueResponse = Schemas["BulkUploadEnqueueResponse"]
export type ResumeUrlUploadRequest = Schemas["ResumeUrlUploadRequest"]
export type ResumeBulkUrlUploadRequest = Schemas["ResumeBulkUrlUploadRequest"]
type GeneratedCandidateFilters =
  operations["list_candidates_api_candidates_get"]["parameters"]["query"]

export type CandidateFilters = GeneratedCandidateFilters & {
  skill_experience?: string[] | null
  role_experience?: string[] | null
  skill_match_mode?: "all" | "any"
  comment_order?: "desc" | "asc"
}

export type HRCommentRead = {
  id: number
  comment: string
  created_at?: string | null
  updated_at?: string | null
}

export type CandidateEducation = {
  institute: string
  degree_name: string
  branch_name?: string | null
  start_date?: string | null
  end_date?: string | null
  year_of_passing?: number | null
  gpa?: number | null
}

export type CandidateSkillProfile = {
  name: string
  context: "primary" | "secondary" | "project" | "mentioned"
  experience_months?: number | null
  experience_years?: number | null
}

export type CandidateRead = {
  id: number
  name?: string | null
  email?: string | null
  phone?: string | null
  location?: string | null
  current_company?: string | null
  experience_years?: number | null
  skills?: string[]
  highest_degree?: string | null
  year_of_passing?: number | null
  gpa?: number | null
  resume_url?: string | null
  hr_comments?: HRCommentRead[]
  matched_skills?: string[]
  missing_skills?: string[]
  interview_date?: string | null
  interview_time?: string | null
  created_at?: string | null
  structured_profile?: Record<string, unknown> | null
  skill_profiles?: CandidateSkillProfile[]
  experiences?: Array<{
    role: string
    company?: string | null
    start_date?: string | null
    end_date?: string | null
    skills_used?: string[]
  }>
  projects?: Array<{
    name: string
    description?: string | null
    start_date?: string | null
    end_date?: string | null
    skills_used?: string[]
  }>
  educations?: CandidateEducation[]
  /** Per-requirement status when `requirement_id` is passed to the list endpoint. */
  requirement_status?: "not_applied" | "new" | "processing" | "rejected" | "hired" | null
}

export type CandidateUpdate = {
  interview_date?: string | null
  interview_time?: string | null
}

export type HRCommentWrite = {
  comment: string
}

export type RequirementSkillInput = {
  name: string
  min_experience_years?: number | null
}

export type RequirementSkillRead = {
  name: string
  min_experience_months?: number | null
  min_experience_years?: number | null
}

export type RequirementCreate = {
  title: string
  skills: RequirementSkillInput[]
  min_experience?: number | null
  max_experience?: number | null
  location?: string | null
  min_ctc?: number | null
  max_ctc?: number | null
  notes?: string | null
  qualification?: string | null
}

export type RequirementRead = {
  id: number
  title: string
  skills: RequirementSkillRead[]
  required_skills?: string[]
  min_experience?: number | null
  max_experience?: number | null
  location?: string | null
  min_ctc?: number | null
  max_ctc?: number | null
  notes?: string | null
  qualification?: string | null
  summary_text?: string | null
  created_at?: string | null
}

export type RequirementExtractRequest = {
  text: string
}

export type RequirementExtractResponse = {
  requirement: RequirementCreate
}

export type CandidateRequirementStatusRead = {
  candidate_id: number
  requirement_id: number
  status: "new" | "processing" | "rejected" | "hired"
}

export type MatchStatusUpdateRequest = {
  status: "new" | "processing" | "rejected" | "hired"
}

export type MatchThresholdStatusRequest = {
  threshold: number
  status: "processing" | "rejected" | "hired"
}

export type BulkStatusUpdateResponse = {
  requirement_id: number
  updated_count: number
  status: "processing" | "rejected" | "hired"
}

export type RequirementOverviewRead = {
  requirement_id: number
  total_current_candidates: number
  total_rejected_candidates: number
  total_hired_candidates: number
  total_processing_candidates: number
}

function buildCandidateQuery(filters?: CandidateFilters): string {
  if (!filters) {
    return ""
  }

  const params = new URLSearchParams()

  if (filters.skills?.length) {
    for (const skill of filters.skills) {
      params.append("skills", skill)
    }
  }

  if (typeof filters.min_exp === "number") {
    params.append("min_exp", String(filters.min_exp))
  }

  if (typeof filters.max_exp === "number") {
    params.append("max_exp", String(filters.max_exp))
  }

  if (filters.location?.trim()) {
    params.append("location", filters.location.trim())
  }

  if (filters.skill_experience?.length) {
    for (const skillExperienceFilter of filters.skill_experience) {
      params.append("skill_experience", skillExperienceFilter)
    }
  }

  if (filters.role_experience?.length) {
    for (const roleExperienceFilter of filters.role_experience) {
      params.append("role_experience", roleExperienceFilter)
    }
  }

  if (filters.skill_match_mode) {
    params.append("skill_match_mode", filters.skill_match_mode)
  }

  if (filters.comment_order) {
    params.append("comment_order", filters.comment_order)
  }

  if (typeof filters.requirement_id === "number") {
    params.append("requirement_id", String(filters.requirement_id))
  }

  const serialized = params.toString()
  return serialized ? `?${serialized}` : ""
}

export async function getSystemHealth(): Promise<HealthResponse> {
  const response = await apiClient.get<HealthResponse>("/api/health")
  return response.data
}

export async function getJobsOverview(): Promise<QueueJobsStatus> {
  const response = await apiClient.get<QueueJobsStatus>("/api/resume/jobs")
  return response.data
}

export async function uploadResumeFile(
  file: File,
  requirementId?: number,
): Promise<UploadEnqueueResponse> {
  const formData = new FormData()
  formData.append("file", file)

  if (typeof requirementId === "number") {
    formData.append("requirement_id", String(requirementId))
  }

  const response = await apiClient.post<UploadEnqueueResponse>(
    "/api/resume/upload",
    formData,
    {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    }
  )

  return response.data
}

export async function uploadResumeFiles(
  files: File[],
  requirementId?: number,
): Promise<BulkUploadEnqueueResponse> {
  const formData = new FormData()
  for (const file of files) {
    formData.append("files", file)
  }

  if (typeof requirementId === "number") {
    formData.append("requirement_id", String(requirementId))
  }

  const response = await apiClient.post<BulkUploadEnqueueResponse>(
    "/api/resume/upload/bulk",
    formData,
    {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    }
  )

  return response.data
}

export async function uploadResumeByUrl(
  payload: ResumeUrlUploadRequest
): Promise<UploadEnqueueResponse> {
  const response = await apiClient.post<UploadEnqueueResponse>(
    "/api/resume/upload/url",
    payload
  )
  return response.data
}

export async function uploadResumeUrlsBulk(
  payload: ResumeBulkUrlUploadRequest
): Promise<BulkUploadEnqueueResponse> {
  const response = await apiClient.post<BulkUploadEnqueueResponse>(
    "/api/resume/upload/url/bulk",
    payload
  )
  return response.data
}

export async function listCandidates(
  filters?: CandidateFilters
): Promise<CandidateRead[]> {
  const query = buildCandidateQuery(filters)
  const response = await apiClient.get<CandidateRead[]>(`/api/candidates${query}`)
  return response.data
}

export async function updateCandidate(
  candidateId: number,
  payload: CandidateUpdate
): Promise<CandidateRead> {
  const response = await apiClient.patch<CandidateRead>(
    `/api/candidates/${candidateId}`,
    payload
  )
  return response.data
}

export async function addCandidateComment(
  candidateId: number,
  payload: HRCommentWrite
): Promise<HRCommentRead> {
  const response = await apiClient.post<HRCommentRead>(
    `/api/candidates/${candidateId}/comments`,
    payload
  )
  return response.data
}

export async function updateCandidateComment(
  candidateId: number,
  commentId: number,
  payload: HRCommentWrite
): Promise<HRCommentRead> {
  const response = await apiClient.patch<HRCommentRead>(
    `/api/candidates/${candidateId}/comments/${commentId}`,
    payload
  )
  return response.data
}

export async function listRequirements(): Promise<RequirementRead[]> {
  const response = await apiClient.get<RequirementRead[]>("/api/requirements")
  return response.data
}

export async function createRequirement(
  payload: RequirementCreate
): Promise<RequirementRead> {
  const response = await apiClient.post<RequirementRead>(
    "/api/requirements",
    payload
  )
  return response.data
}

export async function updateRequirement(
  requirementId: number,
  payload: RequirementCreate
): Promise<RequirementRead> {
  const response = await apiClient.patch<RequirementRead>(
    `/api/requirements/${requirementId}`,
    payload
  )
  return response.data
}

export async function extractRequirementFromText(
  payload: RequirementExtractRequest
): Promise<RequirementCreate> {
  const response = await apiClient.post<RequirementExtractResponse>(
    "/api/requirements/extract",
    payload
  )
  return response.data.requirement
}

export async function runMatching(
  requirementId: number
  , matchAll?: boolean
): Promise<MatchResultRead[]> {
  const query = matchAll ? "?match_all=true" : ""
  const response = await apiClient.post<MatchResultRead[]>(
    `/api/matching/${requirementId}${query}`
  )
  return response.data
}

export async function getMatchingResults(
  requirementId: number
): Promise<MatchResultRead[]> {
  const response = await apiClient.get<MatchResultRead[]>(
    `/api/matching/${requirementId}`
  )
  return response.data
}

export async function runCandidateMatching(
  requirementId: number,
  candidateId: number
): Promise<MatchResultRead[]> {
  const response = await apiClient.post<MatchResultRead[]>(
    `/api/matching/${requirementId}/candidates/${candidateId}`
  )
  return response.data
}

export async function updateMatchStatus(
  requirementId: number,
  candidateId: number,
  payload: MatchStatusUpdateRequest
): Promise<CandidateRequirementStatusRead> {
  const response = await apiClient.patch<CandidateRequirementStatusRead>(
    `/api/matching/${requirementId}/candidates/${candidateId}/status`,
    payload
  )
  return response.data
}

export async function rejectZeroScoreCandidates(
  requirementId: number
): Promise<BulkStatusUpdateResponse> {
  const response = await apiClient.post<BulkStatusUpdateResponse>(
    `/api/matching/${requirementId}/bulk/reject-zero`
  )
  return response.data
}

export async function applyThresholdStatus(
  requirementId: number,
  payload: MatchThresholdStatusRequest
): Promise<BulkStatusUpdateResponse> {
  const response = await apiClient.post<BulkStatusUpdateResponse>(
    `/api/matching/${requirementId}/bulk/threshold`,
    payload
  )
  return response.data
}

export async function getRequirementOverview(
  requirementId: number
): Promise<RequirementOverviewRead> {
  const response = await apiClient.get<RequirementOverviewRead>(
    `/api/matching/overview/${requirementId}`
  )
  return response.data
}

export function getApiErrorMessage(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return "Something went wrong. Please try again."
  }

  const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail

  if (typeof detail === "string") {
    return detail
  }

  if (Array.isArray(detail) && detail.length) {
    const messages = detail
      .map((item) => {
        if (typeof item === "string") {
          return item
        }

        if (item && typeof item === "object" && "msg" in item) {
          const value = item.msg
          return typeof value === "string" ? value : null
        }

        return null
      })
      .filter((message): message is string => Boolean(message))

    if (messages.length) {
      return messages.join(", ")
    }
  }

  return error.message || "Request failed."
}
