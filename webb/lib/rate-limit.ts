import type { NextRequest } from "next/server"

// Simple in-memory rate limiter (use Redis in production)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>()

export function rateLimit(
    request: NextRequest,
    limit = 10,
    windowMs = 60000, // 1 minute
): { success: boolean; remaining: number } {
    const ip = request.ip || request.headers.get("x-forwarded-for") || "unknown"
    const now = Date.now()
    const windowStart = now - windowMs

    // Clean up old entries
    for (const [key, value] of rateLimitMap.entries()) {
        if (value.resetTime < windowStart) {
            rateLimitMap.delete(key)
        }
    }

    const current = rateLimitMap.get(ip)

    if (!current || current.resetTime < windowStart) {
        rateLimitMap.set(ip, { count: 1, resetTime: now + windowMs })
        return { success: true, remaining: limit - 1 }
    }

    if (current.count >= limit) {
        return { success: false, remaining: 0 }
    }

    current.count++
    return { success: true, remaining: limit - current.count }
}
