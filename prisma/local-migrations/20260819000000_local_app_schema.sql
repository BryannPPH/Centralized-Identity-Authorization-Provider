CREATE SCHEMA IF NOT EXISTS "public";

DO $$
BEGIN
  CREATE TYPE "SessionStatus" AS ENUM ('active', 'expired', 'revoked');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "local_sessions" (
  "id" UUID NOT NULL,
  "application_id" TEXT NOT NULL,
  "session_token_hash" TEXT NOT NULL,
  "external_user_id" UUID NOT NULL,
  "central_session_id" UUID NOT NULL,
  "status" "SessionStatus" NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "last_activity_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "revoke_reason" TEXT,
  CONSTRAINT "local_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "profile_cache" (
  "id" UUID NOT NULL,
  "application_id" TEXT NOT NULL,
  "external_user_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "groups" JSONB,
  "synced_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "profile_cache_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "processed_events" (
  "event_id" UUID NOT NULL,
  "application_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "result" TEXT NOT NULL,
  "action" TEXT,
  CONSTRAINT "processed_events_pkey" PRIMARY KEY ("application_id", "event_id")
);

CREATE TABLE IF NOT EXISTS "activity_logs" (
  "id" UUID NOT NULL,
  "application_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "request_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "local_sessions_session_token_hash_key" ON "local_sessions"("session_token_hash");
CREATE INDEX IF NOT EXISTS "local_sessions_application_id_external_user_id_status_idx" ON "local_sessions"("application_id", "external_user_id", "status");
CREATE INDEX IF NOT EXISTS "local_sessions_application_id_central_session_id_idx" ON "local_sessions"("application_id", "central_session_id");
CREATE UNIQUE INDEX IF NOT EXISTS "profile_cache_application_id_external_user_id_key" ON "profile_cache"("application_id", "external_user_id");
CREATE INDEX IF NOT EXISTS "activity_logs_application_id_created_at_idx" ON "activity_logs"("application_id", "created_at");
