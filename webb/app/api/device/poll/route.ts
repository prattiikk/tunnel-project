import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rate-limit"

export async function GET(request: NextRequest) {
    // Rate limiting - more lenient for polling
    const rateLimitResult = rateLimit(request, 30, 60000) // 30 requests per minute
    if (!rateLimitResult.success) {
        return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 })
    }

    const { searchParams } = new URL(request.url)
    const code = searchParams.get("code")

    console.log("=== Device Auth Polling Debug ===")
    console.log("Request URL:", request.url)
    console.log("Code parameter:", code)

    if (!code) {
        console.log("ERROR: No code parameter provided")
        return NextResponse.json({ error: "Code parameter is required" }, { status: 400 })
    }

    try {
        console.log("Searching for device code in database...")
        
        // Find the device code
        const deviceCode = await prisma.deviceAuthCode.findUnique({
            where: { code: code },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                    },
                },
            },
        })

        // console.log("Database query result:", {
        //     found: !!deviceCode,
        //     deviceCodeId: deviceCode?.id,
        //     code: deviceCode?.code,
        //     hasToken: !!deviceCode?.token,
        //     tokenLength: deviceCode?.token?.length || 0,
        //     hasUser: !!deviceCode?.user,
        //     userId: deviceCode?.userId,
        //     userFromInclude: deviceCode?.user?.id,
        //     expiresAt: deviceCode?.expiresAt,
        //     isExpired: deviceCode ? deviceCode.expiresAt < new Date() : null,
        // })

        if (!deviceCode) {
            console.log("ERROR: Device code not found in database")
            return NextResponse.json({ error: "Invalid or expired code" }, { status: 404 })
        }

        // Check if code is expired
        const now = new Date()
        const isExpired = deviceCode.expiresAt < now
        // console.log("Expiration check:", {
        //     now: now.toISOString(),
        //     expiresAt: deviceCode.expiresAt.toISOString(),
        //     isExpired,
        //     timeRemaining: deviceCode.expiresAt.getTime() - now.getTime(),
        // })

        if (isExpired) {
            console.log("Code expired, cleaning up...")
            // Clean up expired code
            await prisma.deviceAuthCode.delete({
                where: { id: deviceCode.id },
            })

            return NextResponse.json({ error: "Code has expired" }, { status: 404 })
        }

        // Check authentication status
        const hasToken = !!deviceCode.token
        const hasUser = !!deviceCode.user
        const hasUserId = !!deviceCode.userId
        
        console.log("Authentication status:", {
            hasToken,
            hasUser,
            hasUserId,
            tokenPreview: deviceCode.token ? `${deviceCode.token.substring(0, 10)}...` : null,
        })

        // Check if user has authenticated and token exists
        if (hasToken && hasUser) {
            console.log("SUCCESS: User is authenticated, returning token and user info")
            return NextResponse.json({
                authenticated: true,
                token: deviceCode.token,
                user: {
                    id: deviceCode.user.id,
                    email: deviceCode.user.email,
                    name: deviceCode.user.name,
                },
            }, { status: 200 })
        }

        // Additional debugging for partial authentication states
        if (hasToken && !hasUser) {
            console.log("WARNING: Has token but no user data - possible database inconsistency")
        }
        if (!hasToken && hasUser) {
            console.log("WARNING: Has user but no token - authentication incomplete")
        }
        if (hasUserId && !hasUser) {
            console.log("WARNING: Has userId but user include failed - check database relations")
        }

        // Not authenticated yet
        console.log("User not yet authenticated, returning pending status")
        return NextResponse.json({
            authenticated: false,
            expiresAt: deviceCode.expiresAt.toISOString(),
        }, { status: 200 })

    } catch (error) {
        console.error("=== ERROR in device polling ===")
        console.error("Error details:", error)
        console.error("Stack trace:", error.stack)
        
        return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
}