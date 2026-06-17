-- CreateTable
CREATE TABLE "profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "isOwner" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "accountSize" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "riskPctPerTrade" DECIMAL(6,4) NOT NULL DEFAULT 0.5,
    "maxOpenPositions" INTEGER NOT NULL DEFAULT 1,
    "maxTradesPerDay" INTEGER NOT NULL DEFAULT 3,
    "takerFeeBps" INTEGER NOT NULL DEFAULT 16,
    "baseCurrency" TEXT NOT NULL DEFAULT 'USD',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_configuration" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "tradingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "killSwitchEngaged" BOOLEAN NOT NULL DEFAULT false,
    "killSwitchReason" TEXT,
    "circuitBreakerMaxDrawdownPct" DECIMAL(6,3) NOT NULL DEFAULT 10,
    "circuitBreakerConsecutiveLosses" INTEGER NOT NULL DEFAULT 5,
    "maintenanceMode" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_configuration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "data" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "profiles_userId_key" ON "profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_email_key" ON "profiles"("email");

-- CreateIndex
CREATE INDEX "audit_logs_at_idx" ON "audit_logs"("at");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");
