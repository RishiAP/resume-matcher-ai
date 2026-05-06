"use client"

import React, { createContext, useContext, useState, useCallback } from "react"
import type { CandidateRead } from "@/lib/api-client"

export type CandidateWithEdits = CandidateRead & {
	_edits?: {
		notes?: string | null
		skillPreferences?: Record<string, "preferred" | "non_preferred" | "unknown">
	}
	_isDirty?: boolean
}

interface CandidateContextType {
	candidates: Map<number, CandidateWithEdits>
	updateCandidate: (candidate: CandidateWithEdits) => void
	updateCandidateNotes: (candidateId: number, notes: string | null) => void
	updateSkillPreference: (candidateId: number, skillName: string, preference: "preferred" | "non_preferred" | "unknown") => void
	getCandidate: (candidateId: number) => CandidateWithEdits | undefined
	getCandidateNotes: (candidateId: number) => string | null | undefined
	getSkillPreference: (candidateId: number, skillName: string) => "preferred" | "non_preferred" | "unknown" | undefined
	clearEdits: (candidateId: number) => void
	syncCandidatesFromAPI: (candidates: CandidateRead[]) => void
}

const CandidateContext = createContext<CandidateContextType | undefined>(undefined)

export function CandidateProvider({ children }: { children: React.ReactNode }) {
	const [candidates, setCandidates] = useState<Map<number, CandidateWithEdits>>(new Map())

	const updateCandidate = useCallback((candidate: CandidateWithEdits) => {
		setCandidates((prev) => {
			const next = new Map(prev)
			next.set(candidate.id, candidate)
			return next
		})
	}, [])

	const updateCandidateNotes = useCallback((candidateId: number, notes: string | null) => {
		setCandidates((prev) => {
			const next = new Map(prev)
			const candidate = next.get(candidateId)
			if (candidate) {
				next.set(candidateId, {
					...candidate,
					_edits: {
						...candidate._edits,
						notes,
					},
					_isDirty: true,
				})
			}
			return next
		})
	}, [])

	const updateSkillPreference = useCallback(
		(candidateId: number, skillName: string, preference: "preferred" | "non_preferred" | "unknown") => {
			setCandidates((prev) => {
				const next = new Map(prev)
				const candidate = next.get(candidateId)
				if (candidate) {
					next.set(candidateId, {
						...candidate,
						_edits: {
							...candidate._edits,
							skillPreferences: {
								...(candidate._edits?.skillPreferences ?? {}),
								[skillName]: preference,
							},
						},
						_isDirty: true,
					})
				}
				return next
			})
		},
		[]
	)

	const getCandidate = useCallback((candidateId: number) => {
		return candidates.get(candidateId)
	}, [candidates])

	const getCandidateNotes = useCallback((candidateId: number) => {
		const candidate = candidates.get(candidateId)
		// Return edited notes if they exist, otherwise return original
		if (candidate?._edits?.notes !== undefined) {
			return candidate._edits.notes
		}
		return candidate?.notes
	}, [candidates])

	const getSkillPreference = useCallback(
		(candidateId: number, skillName: string) => {
			const candidate = candidates.get(candidateId)
			// Return edited preference if it exists
			if (candidate?._edits?.skillPreferences?.[skillName]) {
				return candidate._edits.skillPreferences[skillName]
			}
			// Otherwise find it in skill_profiles
			const skillProfile = candidate?.skill_profiles?.find(
				(sp) => sp.name.toLowerCase() === skillName.toLowerCase()
			)
			return (skillProfile?.preference ?? "unknown") as "preferred" | "non_preferred" | "unknown"
		},
		[candidates]
	)

	const clearEdits = useCallback((candidateId: number) => {
		setCandidates((prev) => {
			const next = new Map(prev)
			const candidate = next.get(candidateId)
			if (candidate) {
				next.set(candidateId, {
					...candidate,
					_edits: undefined,
					_isDirty: false,
				})
			}
			return next
		})
	}, [])

	const syncCandidatesFromAPI = useCallback((apiCandidates: CandidateRead[]) => {
		setCandidates((prev) => {
			const next = new Map(prev)
			for (const apiCandidate of apiCandidates) {
				const existing = next.get(apiCandidate.id)
				if (existing && existing._isDirty) {
					// Keep existing edits
					next.set(apiCandidate.id, {
						...apiCandidate,
						_edits: existing._edits,
						_isDirty: existing._isDirty,
					})
				} else {
					// No edits, just use fresh API data
					next.set(apiCandidate.id, {
						...apiCandidate,
						_edits: undefined,
						_isDirty: false,
					})
				}
			}
			return next
		})
	}, [])

	const value: CandidateContextType = {
		candidates,
		updateCandidate,
		updateCandidateNotes,
		updateSkillPreference,
		getCandidate,
		getCandidateNotes,
		getSkillPreference,
		clearEdits,
		syncCandidatesFromAPI,
	}

	return <CandidateContext.Provider value={value}>{children}</CandidateContext.Provider>
}

export function useCandidateContext() {
	const context = useContext(CandidateContext)
	if (!context) {
		throw new Error("useCandidateContext must be used within CandidateProvider")
	}
	return context
}
