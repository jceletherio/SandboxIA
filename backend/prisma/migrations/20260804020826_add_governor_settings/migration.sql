-- CreateTable
CREATE TABLE "governor_settings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "global_max_sessions" INTEGER NOT NULL DEFAULT 4,
    "cpu_load_threshold" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "min_free_mem_mb" INTEGER NOT NULL DEFAULT 1024,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "governor_settings_pkey" PRIMARY KEY ("id")
);

-- Seed da linha singleton: existe editável desde o primeiro deploy, sem
-- depender do prisma/seed.ts (que não roda em produção). O código também tem
-- fallback pra defaults embutidos caso esta linha suma, mas não deveria.
INSERT INTO "governor_settings" ("id", "updated_at") VALUES ('global', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
