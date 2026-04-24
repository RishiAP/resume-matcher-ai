import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Sign in — Resume Matcher AI",
  description: "Sign in to Resume Matcher AI to manage candidates and run AI-powered matching.",
}

export default function SigninLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
