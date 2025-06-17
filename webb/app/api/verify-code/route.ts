import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rate-limit"

export async function POST(request: NextRequest) {
    // Rate limiting
    const rateLimitResult = rateLimit(request, 10, 60000) // 10 requests per minute
    if (!rateLimitResult.success) {
        return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 })
    }

    try {
        const body = await request.json()
        const { code } = body

        if (!code || typeof code !== "string") {
            return NextResponse.json({ error: "Code is required" }, { status: 400 })
        }

        // Find the device code
        const deviceCode = await prisma.deviceAuthCode.findUnique({
            where: { code: code.toUpperCase() },
        })

        if (!deviceCode) {
            return NextResponse.json({ error: "Invalid code" }, { status: 400 })
        }

        // Check if code is expired
        if (deviceCode.expiresAt < new Date()) {
            // Clean up expired code
            await prisma.deviceAuthCode.delete({
                where: { id: deviceCode.id },
            })

            return NextResponse.json({ error: "Code has expired" }, { status: 400 })
        }

        // Check if code is already used
        if (deviceCode.isUsed) {
            return NextResponse.json({ error: "Code has already been used" }, { status: 400 })
        }

        // Code is valid - create a response that includes redirect URL
        const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000"
        console.log("code is valid and correct lets go for the auth page!")
        return NextResponse.json({
            valid: true,
            redirectUrl: `${baseUrl}/api/auth/signin?callbackUrl=${encodeURIComponent(`${baseUrl}/auth/callback?code=${code}`)}`,
        })
    } catch (error) {
        console.error("Error verifying code:", error)
        return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
}
