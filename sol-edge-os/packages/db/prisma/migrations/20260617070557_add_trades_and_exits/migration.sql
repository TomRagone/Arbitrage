-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('LONG', 'SHORT');

-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "trades" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'PAPER',
    "pair" TEXT NOT NULL,
    "direction" "Direction" NOT NULL,
    "status" "TradeStatus" NOT NULL DEFAULT 'OPEN',
    "entryPrice" DECIMAL(20,8) NOT NULL,
    "initialStop" DECIMAL(20,8) NOT NULL,
    "takeProfit" DECIMAL(20,8) NOT NULL,
    "riskPerUnit" DECIMAL(20,8) NOT NULL,
    "rMultipleTarget" DECIMAL(6,3) NOT NULL,
    "size" DECIMAL(20,8) NOT NULL,
    "approvedReason" TEXT,

    CONSTRAINT "trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_exits" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tradeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "price" DECIMAL(20,8) NOT NULL,
    "sizePortion" DECIMAL(20,8) NOT NULL,
    "rMultiple" DECIMAL(6,3) NOT NULL,

    CONSTRAINT "trade_exits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trades_status_idx" ON "trades"("status");

-- CreateIndex
CREATE INDEX "trades_createdAt_idx" ON "trades"("createdAt");

-- CreateIndex
CREATE INDEX "trade_exits_tradeId_idx" ON "trade_exits"("tradeId");

-- AddForeignKey
ALTER TABLE "trade_exits" ADD CONSTRAINT "trade_exits_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "trades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
