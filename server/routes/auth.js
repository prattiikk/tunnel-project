// server/routes/auth.ts
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const router = express.Router();
const prisma = new PrismaClient();

router.post('/device-code', async (req, res) => {
    const code = randomUUID().slice(0, 8).toUpperCase();

    await prisma.deviceCode.create({
        data: {
            code,
            claimed: false,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000), // expires in 5 min
        }
    });

    return res.json({
        device_code: code,
        verification_uri: 'https://ghostgate.dev/auth',
        expires_in: 300,
        interval: 5
    });
});

export default router;