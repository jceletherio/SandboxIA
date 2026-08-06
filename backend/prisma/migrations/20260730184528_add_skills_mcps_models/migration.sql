-- CreateTable
CREATE TABLE "skills" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcps" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "endpoint" TEXT,
    "connected" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_models" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "context_size" INTEGER,
    "cost_per_token" DOUBLE PRECISION,
    "notes" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "llm_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phase_model_assignments" (
    "id" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "phase_model_assignments_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "phase_model_assignments" ADD CONSTRAINT "phase_model_assignments_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "llm_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
