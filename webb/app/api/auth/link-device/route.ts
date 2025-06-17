import { type NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { signJWT } from "@/lib/jwt"
import { authOptions } from "@/app/api/auth/[...nextauth]/route"

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const body = await request.json()
    const { code } = body

    if (!code) {
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
      await prisma.deviceAuthCode.delete({
        where: { id: deviceCode.id },
      })
      return NextResponse.json({ error: "Code has expired" }, { status: 400 })
    }

    // Check if code is already used
    if (deviceCode.isUsed) {
      return NextResponse.json({ error: "Code has already been used" }, { status: 400 })
    }

    // Find or create user
    const user = await prisma.user.upsert({
      where: { email: session.user.email },
      update: {
        name: session.user.name,
        image: session.user.image,
      },
      create: {
        email: session.user.email,
        name: session.user.name,
        image: session.user.image,
      },
    })

    // Generate JWT token
    const token = signJWT({
      userId: user.id,
      email: user.email!,
      deviceId: deviceCode.deviceId,
    })

    // Update device code with user and token
    await prisma.deviceAuthCode.update({
      where: { id: deviceCode.id },
      data: {
        userId: user.id,
        token,
        isUsed: true,
      },
    })

    // Return the token in the response for browser use (optional)
    return NextResponse.json({
      success: true,
      message: "Device successfully linked",
      token, // <-- include the token in the response
    }, { status: 200 })
  } catch (error) {
    console.error("Error linking device:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
