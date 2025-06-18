import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

// Load and sanitize secret
const rawSecret = process.env.JWT_SECRET || 'iamdobby';
const JWT_SECRET = rawSecret.trim();

if (!process.env.JWT_SECRET) {
    console.warn('⚠️ Warning: JWT_SECRET not found in .env. Using fallback default. Do NOT use in production.');
}

export interface JWTPayload {
    userId: string;
    email: string;
    deviceId: string;
    iat?: number;
    exp?: number;
}

/**
 * Sign a JWT with the given payload (excluding iat and exp)
 */
export function signJWT(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
    return jwt.sign(payload, JWT_SECRET, {
        expiresIn: '30d',
        issuer: 'cli-auth-backend',
    });
}

/**
 * Verifies a JWT and returns the decoded payload, or null if invalid
 */
export function verifyJWT(token: string): JWTPayload | null {
    try {
        const cleanToken = token.trim();
        const payload = jwt.verify(cleanToken, JWT_SECRET) as JWTPayload;
        return payload;
    } catch (error: any) {
        if (process.env.NODE_ENV !== 'production') {
            console.error(`❌ JWT verification failed: ${error.message}`);
        }
        return null;
    }
}