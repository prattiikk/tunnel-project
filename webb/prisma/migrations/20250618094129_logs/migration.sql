-- CreateTable
CREATE TABLE "Tunnel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT,
    "subdomain" TEXT NOT NULL,
    "localPort" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3),

    CONSTRAINT "Tunnel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HourlyStats" (
    "id" TEXT NOT NULL,
    "tunnelId" TEXT NOT NULL,
    "hour" TIMESTAMP(3) NOT NULL,
    "totalRequests" INTEGER NOT NULL DEFAULT 0,
    "successRequests" INTEGER NOT NULL DEFAULT 0,
    "errorRequests" INTEGER NOT NULL DEFAULT 0,
    "avgResponseTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalBandwidth" BIGINT NOT NULL DEFAULT 0,
    "uniqueIps" INTEGER NOT NULL DEFAULT 0,
    "topPaths" JSONB,
    "topCountries" JSONB,
    "statusCodes" JSONB,

    CONSTRAINT "HourlyStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyStats" (
    "id" TEXT NOT NULL,
    "tunnelId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "totalRequests" INTEGER NOT NULL DEFAULT 0,
    "successRequests" INTEGER NOT NULL DEFAULT 0,
    "errorRequests" INTEGER NOT NULL DEFAULT 0,
    "avgResponseTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalBandwidth" BIGINT NOT NULL DEFAULT 0,
    "uniqueIps" INTEGER NOT NULL DEFAULT 0,
    "peakHour" INTEGER,
    "topPaths" JSONB,
    "topCountries" JSONB,
    "statusCodes" JSONB,

    CONSTRAINT "DailyStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveStats" (
    "tunnelId" TEXT NOT NULL,
    "requestsLast5Min" INTEGER NOT NULL DEFAULT 0,
    "requestsLast1Hour" INTEGER NOT NULL DEFAULT 0,
    "avgResponseTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "errorRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveStats_pkey" PRIMARY KEY ("tunnelId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tunnel_subdomain_key" ON "Tunnel"("subdomain");

-- CreateIndex
CREATE INDEX "Tunnel_userId_idx" ON "Tunnel"("userId");

-- CreateIndex
CREATE INDEX "Tunnel_subdomain_idx" ON "Tunnel"("subdomain");

-- CreateIndex
CREATE INDEX "HourlyStats_tunnelId_idx" ON "HourlyStats"("tunnelId");

-- CreateIndex
CREATE INDEX "HourlyStats_hour_idx" ON "HourlyStats"("hour");

-- CreateIndex
CREATE UNIQUE INDEX "HourlyStats_tunnelId_hour_key" ON "HourlyStats"("tunnelId", "hour");

-- CreateIndex
CREATE INDEX "DailyStats_tunnelId_idx" ON "DailyStats"("tunnelId");

-- CreateIndex
CREATE INDEX "DailyStats_date_idx" ON "DailyStats"("date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyStats_tunnelId_date_key" ON "DailyStats"("tunnelId", "date");

-- CreateIndex
CREATE INDEX "LiveStats_tunnelId_idx" ON "LiveStats"("tunnelId");

-- AddForeignKey
ALTER TABLE "Tunnel" ADD CONSTRAINT "Tunnel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HourlyStats" ADD CONSTRAINT "HourlyStats_tunnelId_fkey" FOREIGN KEY ("tunnelId") REFERENCES "Tunnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyStats" ADD CONSTRAINT "DailyStats_tunnelId_fkey" FOREIGN KEY ("tunnelId") REFERENCES "Tunnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
