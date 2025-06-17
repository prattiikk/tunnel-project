"use client"

import { useState, useEffect } from "react"
import type React from "react"
import { useSession } from "next-auth/react"
import { useSearchParams } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Loader2 } from "lucide-react"

export default function ActivatePage() {
  const [code, setCode] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  const { data: session, status } = useSession()
  const searchParams = useSearchParams()

  // Automatically link device if code is in query and user is authenticated
  useEffect(() => {
    const code = searchParams.get("code")
    if (!code || status !== "authenticated") return

    const linkDevice = async () => {
      try {
        const res = await fetch("/api/activate/confirm", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ code }),
        })

        const result = await res.json()

        if (!res.ok) {
          console.error("Error linking device:", result.error)
          setError(result.error || "Failed to link device")
        } else {
          setSuccess("Device successfully linked!")
        }
      } catch (err) {
        console.error("Failed to link device:", err)
        setError("Network error while linking device")
      }
    }

    linkDevice()
  }, [status, searchParams])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")
    setSuccess("")

    try {
      const response = await fetch("/api/verify-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code: code.toUpperCase() }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || "Failed to verify code")
        return
      }

      if (data.valid && data.redirectUrl) {
        window.location.href = data.redirectUrl
      } else {
        setError("Invalid response. Try again.")
      }
    } catch (err) {
      setError("Network error. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Activate Your Device</CardTitle>
          <CardDescription>Enter the code displayed in your CLI to continue</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="code">Activation Code</Label>
              <Input
                id="code"
                type="text"
                placeholder="ABC123"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={8}
                className="text-center text-lg font-mono tracking-wider"
                required
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {success && (
              <Alert variant="default">
                <AlertDescription>{success}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" className="w-full" disabled={loading || code.length < 6}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                "Continue to Sign In"
              )}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-gray-600">
            <p>{"Don't have a code?"}</p>
            <p className="mt-1">Run your CLI command to get started.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}