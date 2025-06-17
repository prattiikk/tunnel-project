-- Create database and run Prisma migrations
-- This script sets up the initial database structure

-- First, make sure to run: npx prisma migrate dev --name init
-- This will create the tables based on the Prisma schema

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_device_auth_code_expires ON "DeviceAuthCode"("expiresAt");
CREATE INDEX IF NOT EXISTS idx_device_auth_code_code ON "DeviceAuthCode"("code");
CREATE INDEX IF NOT EXISTS idx_user_email ON "User"("email");

-- Clean up expired device codes (run this periodically)
DELETE FROM "DeviceAuthCode" WHERE "expiresAt" < NOW();
