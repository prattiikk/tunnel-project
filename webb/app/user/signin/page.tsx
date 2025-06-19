"use client"

import { signIn, getProviders } from "next-auth/react"
import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Github } from "lucide-react"
import Link from "next/link"

interface Provider {
    id: string
    name: string
    type: string
    signinUrl: string
    callbackUrl: string
}

export default function UserSignInPage() {
    const [providers, setProviders] = useState<Record<string, Provider> | null>(null)
    const [loading, setLoading] = useState(false)
    const router = useRouter()
    const searchParams = useSearchParams()
    const callbackUrl = searchParams.get("callbackUrl") || "/user/dashboard"
    const error = searchParams.get("error")

    useEffect(() => {
        const fetchProviders = async () => {
            const res = await getProviders()
            setProviders(res)
        }
        fetchProviders()
    }, [])

    const handleSignIn = async (providerId: string) => {
        setLoading(true)
        try {
            await signIn(providerId, { callbackUrl })
        } catch (error) {
            console.error("Sign in error:", error)
        } finally {
            setLoading(false)
        }
    }

    const getProviderIcon = (providerId: string) => {
        switch (providerId) {
            case "github":
                return <Github className="h-5 w-5" />
            case "google":
                return (
                    <svg className="h-5 w-5" viewBox="0 0 24 24">
                        <path
                            fill="currentColor"
                            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        />
                        <path
                            fill="currentColor"
                            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        />
                        <path
                            fill="currentColor"
                            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        />
                        <path
                            fill="currentColor"
                            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        />
                    </svg>
                )
            default:
                return null
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <CardTitle className="text-2xl font-bold">Welcome Back</CardTitle>
                    <CardDescription>Sign in to your account to manage your tunnels and view analytics</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {error && (
                        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm">
                            {error === "OAuthSignin" && "Error occurred during sign in. Please try again."}
                            {error === "OAuthCallback" && "Error occurred during authentication. Please try again."}
                            {error === "OAuthCreateAccount" && "Could not create account. Please try again."}
                            {error === "EmailCreateAccount" && "Could not create account. Please try again."}
                            {error === "Callback" && "Error occurred during callback. Please try again."}
                            {error === "OAuthAccountNotLinked" && "Account is already linked to another provider."}
                            {error === "EmailSignin" && "Check your email for the sign in link."}
                            {error === "CredentialsSignin" && "Invalid credentials. Please check your details."}
                            {error === "SessionRequired" && "Please sign in to access this page."}
                            {![
                                "OAuthSignin",
                                "OAuthCallback",
                                "OAuthCreateAccount",
                                "EmailCreateAccount",
                                "Callback",
                                "OAuthAccountNotLinked",
                                "EmailSignin",
                                "CredentialsSignin",
                                "SessionRequired",
                            ].includes(error) && "An error occurred. Please try again."}
                        </div>
                    )}

                    {providers &&
                        Object.values(providers).map((provider) => (
                            <Button
                                key={provider.name}
                                variant="outline"
                                className="w-full"
                                onClick={() => handleSignIn(provider.id)}
                                disabled={loading}
                            >
                                {getProviderIcon(provider.id)}
                                <span className="ml-2">Continue with {provider.name}</span>
                            </Button>
                        ))}

                    <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-gray-50 px-2 text-gray-500">Or</span>
                        </div>
                    </div>

                    <div className="text-center">
                        <p className="text-sm text-gray-600">
                            {"Don't have an account?"}{" "}
                            <Link href="/user/signup" className="font-medium text-blue-600 hover:text-blue-500">
                                Sign up here
                            </Link>
                        </p>
                    </div>

                    <div className="text-center text-xs text-gray-500 mt-6">
                        <p>Looking for device authentication?</p>
                        <Link href="/activate" className="text-blue-600 hover:text-blue-500">
                            Activate CLI Device
                        </Link>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
