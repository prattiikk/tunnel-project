// /app/api/activate/confirm/route.ts

import { getServerSession } from "next-auth"
import { authOptions } from "@/app/api/auth/[...nextauth]/route"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"

export async function POST(req: Request) {
    const session = await getServerSession(authOptions)

    if (!session?.user?.email) {
        return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const body = await req.json()
    const { code } = body

    if (!code) {
        return NextResponse.json({ error: "Code is required" }, { status: 400 })
    }


    // Optional: generate token (you can generate JWT or a random one-time string)
    const token = crypto.randomUUID()

    await prisma.deviceAuthCode.update({
        where: { code },
        data: {
            userId: session.user.id,
            token,
        },
    })

    return NextResponse.json({ success: true })
}