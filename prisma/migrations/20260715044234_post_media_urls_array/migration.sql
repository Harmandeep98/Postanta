/*
  Warnings:

  - You are about to drop the column `mediaUrl` on the `ScheduledPost` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ScheduledPost" DROP COLUMN "mediaUrl",
ADD COLUMN     "mediaUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];
