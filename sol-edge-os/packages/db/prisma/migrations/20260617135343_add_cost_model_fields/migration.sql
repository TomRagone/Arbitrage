-- AlterTable
ALTER TABLE "system_configuration" ADD COLUMN     "feeRateEntryBps" INTEGER NOT NULL DEFAULT 16,
ADD COLUMN     "feeRateExitBps" INTEGER NOT NULL DEFAULT 16,
ADD COLUMN     "slippageBps" INTEGER NOT NULL DEFAULT 5;
