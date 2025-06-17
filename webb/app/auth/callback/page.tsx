"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { CheckCircle, Loader2, XCircle } from "lucide-react"

export default function AuthCallbackPage() {
    const { data: session, status } = useSession()
    const searchParams = useSearchParams()
    const code = searchParams.get("code")
    const [authStatus, setAuthStatus] = useState<"loading" | "success" | "error">("loading")
    const [message, setMessage] = useState("")

    useEffect(() => {
        console.log("status : ", status)
        if (status === "loading") return

        if (status === "authenticated" && session?.user && code) {
            // Link the authenticated user to the device code
            linkUserToDevice()
        } else if (status === "unauthenticated") {
            setAuthStatus("error")
            setMessage("Authentication failed. Please try again.")
        }
    }, [status, session, code])

    const linkUserToDevice = async () => {
        try {
            const response = await fetch("/api/auth/link-device", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ code }),
            })

            const data = await response.json()

            if (response.ok) {
                setAuthStatus("success")
                setMessage("Device successfully authenticated! You can now close this window and return to your CLI.")
            } else {
                setAuthStatus("error")
                setMessage(data.error || "Failed to link device")
            }
        } catch (error) {
            setAuthStatus("error")
            setMessage("Network error occurred")
        }
    }

    const getIcon = () => {
        switch (authStatus) {
            case "loading":
                return <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            case "success":
                return <CheckCircle className="h-8 w-8 text-green-500" />
            case "error":
                return <XCircle className="h-8 w-8 text-red-500" />
        }
    }

    const getTitle = () => {
        switch (authStatus) {
            case "loading":
                return "Authenticating Device..."
            case "success":
                return "Authentication Successful!"
            case "error":
                return "Authentication Failed"
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <div className="flex justify-center mb-4">{getIcon()}</div>
                    <CardTitle className="text-2xl font-bold">{getTitle()}</CardTitle>
                    <CardDescription>
                        {authStatus === "loading" && "Please wait while we authenticate your device..."}
                        {authStatus === "success" && "Your CLI device has been successfully authenticated."}
                        {authStatus === "error" && "There was a problem authenticating your device."}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {message && (
                        <Alert variant={authStatus === "error" ? "destructive" : "default"}>
                            <AlertDescription>{message}</AlertDescription>
                        </Alert>
                    )}

                    {session?.user && authStatus === "success" && (
                        <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                            <p className="text-sm text-gray-600">Authenticated as:</p>
                            <p className="font-medium">{session.user.name || session.user.email}</p>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
