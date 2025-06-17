// In your main server.js or a background task file
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const cleanExpiredDeviceCodes = async () => {
    try {
        const deleted = await prisma.deviceCode.deleteMany({
            where: {
                expiresAt: { lt: new Date() },
            },
        });

        if (deleted.count > 0) {
            console.log(`[Cleanup] Deleted ${deleted.count} expired device codes.`);
        }
    } catch (err) {
        console.error('[Cleanup Error]', err);
    }
};

// Run every 5 minutes
setInterval(cleanExpiredDeviceCodes, 5 * 60 * 1000); // 5 minutes