import { type NextRequest, NextResponse } from "next/server"
import { verifyJWT } from "@/lib/jwt"
import { prisma } from "@/lib/prisma"

export async function GET(request: NextRequest) {
    const authHeader = request.headers.get("authorization")

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return NextResponse.json({ error: "Missing or invalid authorization header" }, { status: 401 })
    }

    const token = authHeader.substring(7) // Remove 'Bearer ' prefix

    try {
        const payload = verifyJWT(token)

        if (!payload) {
            return NextResponse.json({ error: "Invalid token" }, { status: 401 })
        }

        // Verify user still exists
        const user = await prisma.user.findUnique({
            where: { id: payload.userId },
            select: {
                id: true,
                email: true,
                name: true,
            },
        })

        if (!user) {
            return NextResponse.json({ error: "User not found" }, { status: 401 })
        }

        return NextResponse.json({
            valid: true,
            user,
            deviceId: payload.deviceId,
        })
    } catch (error) {
        console.error("Error verifying token:", error)
        return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
}
