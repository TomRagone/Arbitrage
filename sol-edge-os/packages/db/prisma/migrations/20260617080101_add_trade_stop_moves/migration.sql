-- CreateTable
CREATE TABLE "trade_stop_moves" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tradeId" TEXT NOT NULL,
    "fromPrice" DECIMAL(20,8) NOT NULL,
    "toPrice" DECIMAL(20,8) NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "trade_stop_moves_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trade_stop_moves_tradeId_idx" ON "trade_stop_moves"("tradeId");

-- AddForeignKey
ALTER TABLE "trade_stop_moves" ADD CONSTRAINT "trade_stop_moves_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "trades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
