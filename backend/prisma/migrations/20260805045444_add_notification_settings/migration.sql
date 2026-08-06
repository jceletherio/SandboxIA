-- CreateTable
CREATE TABLE "notification_settings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "public_base_url" TEXT,
    "dedupe_window_sec" INTEGER NOT NULL DEFAULT 300,
    "ntfy_enabled" BOOLEAN NOT NULL DEFAULT false,
    "ntfy_server_url" TEXT NOT NULL DEFAULT 'https://ntfy.sh',
    "ntfy_topic" TEXT,
    "ntfy_token" TEXT,
    "webhook_enabled" BOOLEAN NOT NULL DEFAULT false,
    "webhook_url" TEXT,
    "webhook_secret" TEXT,
    "notify_question" BOOLEAN NOT NULL DEFAULT true,
    "notify_escalation" BOOLEAN NOT NULL DEFAULT true,
    "notify_stalled" BOOLEAN NOT NULL DEFAULT true,
    "notify_stage_failed" BOOLEAN NOT NULL DEFAULT true,
    "notify_session_failed" BOOLEAN NOT NULL DEFAULT true,
    "notify_session_completed" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);
