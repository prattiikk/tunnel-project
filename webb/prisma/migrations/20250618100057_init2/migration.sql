/*
  Warnings:

  - You are about to drop the `DailyStats` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `HourlyStats` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `LiveStats` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Tunnel` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "DailyStats" DROP CONSTRAINT "DailyStats_tunnelId_fkey";

-- DropForeignKey
ALTER TABLE "HourlyStats" DROP CONSTRAINT "HourlyStats_tunnelId_fkey";

-- DropForeignKey
ALTER TABLE "Tunnel" DROP CONSTRAINT "Tunnel_userId_fkey";

-- DropTable
DROP TABLE "DailyStats";

-- DropTable
DROP TABLE "HourlyStats";

-- DropTable
DROP TABLE "LiveStats";

-- DropTable
DROP TABLE "Tunnel";
