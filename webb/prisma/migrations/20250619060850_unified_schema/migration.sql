/*
  Warnings:

  - You are about to drop the `DeviceAuthCode` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Account" DROP CONSTRAINT "Account_userId_fkey";

-- DropForeignKey
ALTER TABLE "DeviceAuthCode" DROP CONSTRAINT "DeviceAuthCode_userId_fkey";

-- DropForeignKey
ALTER TABLE "Session" DROP CONSTRAINT "Session_userId_fkey";

-- DropTable
DROP TABLE "DeviceAuthCode";

-- DropTable
DROP TABLE "User";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_auth_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,
    "token" TEXT,
    "isUsed" BOOLEAN NOT NULL DEFAULT false,
    "claimed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "device_auth_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tunnels" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subdomain" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tunnels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_stats" (
    "id" TEXT NOT NULL,
    "tunnelId" TEXT NOT NULL,
    "requestsLast5Min" INTEGER NOT NULL DEFAULT 0,
    "requestsLast1Hour" INTEGER NOT NULL DEFAULT 0,
    "avgResponseTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "errorRate" INTEGER NOT NULL DEFAULT 0,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hourly_stats" (
    "id" TEXT NOT NULL,
    "tunnelId" TEXT NOT NULL,
    "hour" TIMESTAMP(3) NOT NULL,
    "totalRequests" INTEGER NOT NULL,
    "successRequests" INTEGER NOT NULL,
    "errorRequests" INTEGER NOT NULL,
    "avgResponseTime" DOUBLE PRECISION NOT NULL,
    "totalBandwidth" BIGINT NOT NULL,
    "uniqueIps" INTEGER NOT NULL,
    "topPaths" JSONB NOT NULL,
    "topCountries" JSONB NOT NULL,
    "statusCodes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hourly_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_stats" (
    "id" TEXT NOT NULL,
    "tunnelId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "totalRequests" INTEGER NOT NULL,
    "successRequests" INTEGER NOT NULL,
    "errorRequests" INTEGER NOT NULL,
    "avgResponseTime" DOUBLE PRECISION NOT NULL,
    "totalBandwidth" BIGINT NOT NULL,
    "uniqueIps" INTEGER NOT NULL,
    "peakHour" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_logs" (
    "id" TEXT NOT NULL,
    "tunnelId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "responseTime" INTEGER NOT NULL,
    "requestSize" INTEGER NOT NULL,
    "responseSize" INTEGER NOT NULL,
    "clientIp" TEXT NOT NULL,
    "country" TEXT,
    "userAgent" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "device_auth_codes_code_key" ON "device_auth_codes"("code");

-- CreateIndex
CREATE INDEX "device_auth_codes_code_idx" ON "device_auth_codes"("code");

-- CreateIndex
CREATE INDEX "device_auth_codes_expiresAt_idx" ON "device_auth_codes"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "tunnels_subdomain_key" ON "tunnels"("subdomain");

-- CreateIndex
CREATE INDEX "tunnels_userId_idx" ON "tunnels"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "live_stats_tunnelId_key" ON "live_stats"("tunnelId");

-- CreateIndex
CREATE INDEX "hourly_stats_tunnelId_hour_idx" ON "hourly_stats"("tunnelId", "hour");

-- CreateIndex
CREATE UNIQUE INDEX "hourly_stats_tunnelId_hour_key" ON "hourly_stats"("tunnelId", "hour");

-- CreateIndex
CREATE INDEX "daily_stats_tunnelId_date_idx" ON "daily_stats"("tunnelId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_stats_tunnelId_date_key" ON "daily_stats"("tunnelId", "date");

-- CreateIndex
CREATE INDEX "request_logs_tunnelId_timestamp_idx" ON "request_logs"("tunnelId", "timestamp");

-- CreateIndex
CREATE INDEX "request_logs_timestamp_idx" ON "request_logs"("timestamp");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_auth_codes" ADD CONSTRAINT "device_auth_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tunnels" ADD CONSTRAINT "tunnels_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_stats" ADD CONSTRAINT "live_stats_tunnelId_fkey" FOREIGN KEY ("tunnelId") REFERENCES "tunnels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hourly_stats" ADD CONSTRAINT "hourly_stats_tunnelId_fkey" FOREIGN KEY ("tunnelId") REFERENCES "tunnels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_stats" ADD CONSTRAINT "daily_stats_tunnelId_fkey" FOREIGN KEY ("tunnelId") REFERENCES "tunnels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_tunnelId_fkey" FOREIGN KEY ("tunnelId") REFERENCES "tunnels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
