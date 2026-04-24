"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import axios from "axios"
import { login } from "@/lib/api-client"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel, FieldContent, FieldError } from "@/components/ui/field"
import { toast } from "sonner"

export default function SigninPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const schema = z.object({
    identifier: z.string().min(1, "Username or email is required"),
    password: z.string().min(6, "Password must be at least 6 characters"),
  })

  type FormValues = z.infer<typeof schema>

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  async function onSubmit(data: FormValues) {
    setLoading(true)
    try {
      await login(data.identifier, data.password)
      toast.success("Signed in")
      const rawFrom = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("from") || "/dashboard" : "/dashboard"
      let target = "/dashboard"
      if (rawFrom) {
        try {
          const decoded = decodeURIComponent(rawFrom)
          if (decoded.startsWith("/")) {
            target = decoded
          } else if (typeof window !== "undefined") {
            try {
              const url = new URL(decoded, window.location.origin)
              if (url.origin === window.location.origin) target = url.pathname + url.search + url.hash
            } catch {
              // fallthrough to default
            }
          }
        } catch {
          if (rawFrom.startsWith("/")) target = rawFrom
        }
      }
      router.push(target)
    } catch (err: unknown) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined
      if (status === 401) {
        toast.error("Invalid credentials")
      } else {
        toast.error("Server error")
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-semibold mb-4">Sign in</h1>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field>
            <FieldLabel>Username or email</FieldLabel>
            <FieldContent>
              <Input {...register("identifier")} placeholder="username or email" />
              <FieldError errors={[{ message: errors.identifier?.message }]} />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>Password</FieldLabel>
            <FieldContent>
              <Input type="password" {...register("password")} placeholder="Password" />
              <FieldError errors={[{ message: errors.password?.message }]} />
            </FieldContent>
          </Field>

          <div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </div>
        </form>
      </div>
    </main>
  )
}
