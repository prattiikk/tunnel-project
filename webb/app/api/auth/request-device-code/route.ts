import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { generateDeviceCode, generateDeviceId } from "@/lib/generate-code"
import { rateLimit } from "@/lib/rate-limit"

export async function POST(request: NextRequest) {
    // Rate limiting
    const rateLimitResult = rateLimit(request, 5, 60000) // 5 requests per minute
    if (!rateLimitResult.success) {
        return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 })
    }

    try {
        // Use provided deviceId or generate a new one
        const finalDeviceId = generateDeviceId()

        console.log("device code asked !!! ")

        // Generate a unique code
        let code: string
        let attempts = 0
        const maxAttempts = 10

        do {
            code = generateDeviceCode()
            attempts++

            // Check if code already exists
            const existing = await prisma.deviceAuthCode.findUnique({
                where: { code },
            })

            if (!existing) break

            if (attempts >= maxAttempts) {
                return NextResponse.json({ error: "Unable to generate unique code. Please try again." }, { status: 500 })
            }
        } while (true)

        // Clean up expired codes for this device
        await prisma.deviceAuthCode.deleteMany({
            where: {
                deviceId: finalDeviceId,
                expiresAt: { lt: new Date() },
            },
        })

        // Create new device auth code
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes

        await prisma.deviceAuthCode.create({
            data: {
                code,
                deviceId: finalDeviceId,
                expiresAt,
            },
        })

        const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000"

        return NextResponse.json({
            code,
            url: `${baseUrl}/activate`,
            expiresIn: 300, // 5 minutes in seconds
            deviceId: finalDeviceId,
        })
    } catch (error) {
        console.error("Error generating device code:", error)
        return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
}
