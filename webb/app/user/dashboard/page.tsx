"use client"

import { useSession, signOut } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/seperator"
import { User, Mail, Shield, LogOut, Settings, Activity, Globe, Loader2 } from "lucide-react"

export default function UserDashboard() {
    const { data: session, status } = useSession()
    const router = useRouter()
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (status === "loading") return

        if (status === "unauthenticated") {
            router.push("/user/signin")
            return
        }

        setLoading(false)
    }, [status, router])

    const handleSignOut = async () => {
        await signOut({ callbackUrl: "/" })
    }

    if (loading || status === "loading") {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="flex items-center space-x-2">
                    <Loader2 className="h-6 w-6 animate-spin" />
                    <span>Loading...</span>
                </div>
            </div>
        )
    }

    if (!session?.user) {
        return null
    }

    const user = session.user
    const userInitials = user.name
        ? user.name
            .split(" ")
            .map((n) => n[0])
            .join("")
            .toUpperCase()
        : user.email?.[0]?.toUpperCase() || "U"

    return (
        <div className="min-h-screen bg-gray-50 py-8">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
                            <p className="text-gray-600 mt-1">Welcome back, {user.name || "User"}!</p>
                        </div>
                        <Button variant="outline" onClick={handleSignOut} className="flex items-center space-x-2">
                            <LogOut className="h-4 w-4" />
                            <span>Sign Out</span>
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* User Profile Card */}
                    <div className="lg:col-span-1">
                        <Card>
                            <CardHeader className="text-center">
                                <div className="flex justify-center mb-4">
                                    <Avatar className="h-20 w-20">
                                        <AvatarImage src={user.image || undefined} alt={user.name || "User"} />
                                        <AvatarFallback className="text-lg font-semibold">{userInitials}</AvatarFallback>
                                    </Avatar>
                                </div>
                                <CardTitle className="text-xl">{user.name || "Anonymous User"}</CardTitle>
                                <CardDescription>{user.email}</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex items-center space-x-3 text-sm">
                                    <User className="h-4 w-4 text-gray-500" />
                                    <span className="text-gray-600">User ID:</span>
                                    <code className="text-xs bg-gray-100 px-2 py-1 rounded">{user.id}</code>
                                </div>

                                <div className="flex items-center space-x-3 text-sm">
                                    <Mail className="h-4 w-4 text-gray-500" />
                                    <span className="text-gray-600">Email:</span>
                                    <span className="font-medium">{user.email}</span>
                                </div>

                                <div className="flex items-center space-x-3 text-sm">
                                    <Shield className="h-4 w-4 text-gray-500" />
                                    <span className="text-gray-600">Status:</span>
                                    <Badge variant="secondary" className="bg-green-100 text-green-800">
                                        Active
                                    </Badge>
                                </div>

                                <Separator />

                                <div className="space-y-2">
                                    <Button variant="outline" className="w-full justify-start" disabled>
                                        <Settings className="h-4 w-4 mr-2" />
                                        Account Settings
                                        <Badge variant="secondary" className="ml-auto text-xs">
                                            Soon
                                        </Badge>
                                    </Button>

                                    <Button variant="outline" className="w-full justify-start" disabled>
                                        <Activity className="h-4 w-4 mr-2" />
                                        Activity Log
                                        <Badge variant="secondary" className="ml-auto text-xs">
                                            Soon
                                        </Badge>
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Main Content Area */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* Welcome Card */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center space-x-2">
                                    <Globe className="h-5 w-5" />
                                    <span>Welcome to Tunnel Manager</span>
                                </CardTitle>
                                <CardDescription>Your account has been successfully created and authenticated.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="p-4 bg-blue-50 rounded-lg">
                                        <h3 className="font-semibold text-blue-900 mb-2">Create Tunnels</h3>
                                        <p className="text-sm text-blue-700">
                                            Set up secure tunnels to expose your local development servers to the internet.
                                        </p>
                                    </div>

                                    <div className="p-4 bg-green-50 rounded-lg">
                                        <h3 className="font-semibold text-green-900 mb-2">Monitor Analytics</h3>
                                        <p className="text-sm text-green-700">
                                            Track requests, monitor performance, and analyze traffic patterns in real-time.
                                        </p>
                                    </div>

                                    <div className="p-4 bg-purple-50 rounded-lg">
                                        <h3 className="font-semibold text-purple-900 mb-2">Device Authentication</h3>
                                        <p className="text-sm text-purple-700">
                                            Securely authenticate CLI devices and manage access tokens.
                                        </p>
                                    </div>

                                    <div className="p-4 bg-orange-50 rounded-lg">
                                        <h3 className="font-semibold text-orange-900 mb-2">Custom Domains</h3>
                                        <p className="text-sm text-orange-700">
                                            Use custom subdomains and configure advanced tunnel settings.
                                        </p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Quick Actions */}
                        <Card>
                            <CardHeader>
                                <CardTitle>Quick Actions</CardTitle>
                                <CardDescription>Get started with these common tasks</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <Button variant="outline" className="justify-start h-auto p-4" disabled>
                                        <div className="text-left">
                                            <div className="font-medium">Create New Tunnel</div>
                                            <div className="text-sm text-gray-500">Set up a new tunnel endpoint</div>
                                        </div>
                                    </Button>

                                    <Button variant="outline" className="justify-start h-auto p-4" disabled>
                                        <div className="text-left">
                                            <div className="font-medium">View Analytics</div>
                                            <div className="text-sm text-gray-500">Monitor tunnel performance</div>
                                        </div>
                                    </Button>

                                    <Button
                                        variant="outline"
                                        className="justify-start h-auto p-4"
                                        onClick={() => router.push("/activate")}
                                    >
                                        <div className="text-left">
                                            <div className="font-medium">Authenticate Device</div>
                                            <div className="text-sm text-gray-500">Link a CLI device to your account</div>
                                        </div>
                                    </Button>

                                    <Button variant="outline" className="justify-start h-auto p-4" disabled>
                                        <div className="text-left">
                                            <div className="font-medium">Manage Domains</div>
                                            <div className="text-sm text-gray-500">Configure custom subdomains</div>
                                        </div>
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Session Information */}
                        <Card>
                            <CardHeader>
                                <CardTitle>Session Information</CardTitle>
                                <CardDescription>Details about your current authentication session</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center py-2">
                                        <span className="text-sm font-medium">Session Status:</span>
                                        <Badge variant="secondary" className="bg-green-100 text-green-800">
                                            Authenticated
                                        </Badge>
                                    </div>

                                    <div className="flex justify-between items-center py-2">
                                        <span className="text-sm font-medium">Authentication Method:</span>
                                        <span className="text-sm text-gray-600">OAuth Provider</span>
                                    </div>

                                    <div className="flex justify-between items-center py-2">
                                        <span className="text-sm font-medium">Account Type:</span>
                                        <span className="text-sm text-gray-600">Standard User</span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>
        </div>
    )
}
