import jwt from "jsonwebtoken"

const JWT_SECRET = process.env.JWT_SECRET || "your-super-secret-jwt-key"

export interface JWTPayload {
    userId: string
    email: string
    deviceId: string
    iat?: number
    exp?: number
}

export function signJWT(payload: Omit<JWTPayload, "iat" | "exp">): string {
    return jwt.sign(payload, JWT_SECRET, {
        expiresIn: "30d", // Token expires in 30 days
        issuer: "cli-auth-backend",
    })
}

export function verifyJWT(token: string): JWTPayload | null {
    try {
        return jwt.verify(token, JWT_SECRET) as JWTPayload
    } catch (error) {
        return null
    }
}
