-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('active', 'expired', 'revoked');

-- CreateEnum
CREATE TYPE "TokenStatus" AS ENUM ('active', 'expired', 'revoked');

-- CreateEnum
CREATE TYPE "PolicyEffect" AS ENUM ('allow');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('success', 'failed');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('pending', 'published', 'processed', 'dead_lettered');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('pending', 'processing', 'succeeded', 'retrying', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_groups" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_secret_hash" TEXT,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'active',
    "launch_url" TEXT,
    "logout_notification_url" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_redirect_uris" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_redirect_uris_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_group_policies" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "effect" "PolicyEffect" NOT NULL DEFAULT 'allow',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_group_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sso_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_token_hash" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_activity_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "revoke_reason" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "sso_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authorization_codes" (
    "id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "sso_session_id" UUID NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "code_challenge_method" TEXT NOT NULL DEFAULT 'S256',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),

    CONSTRAINT "authorization_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_tokens" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "sso_session_id" UUID NOT NULL,
    "scopes" JSONB,
    "status" "TokenStatus" NOT NULL DEFAULT 'active',
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor_id" UUID,
    "user_id" UUID,
    "application_id" UUID,
    "session_id" UUID,
    "result" "AuditResult" NOT NULL,
    "metadata" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "central_session_id" UUID,
    "application_id" UUID,
    "payload" JSONB NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_deliveries" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ(6),
    "next_retry_at" TIMESTAMPTZ(6),
    "processed_at" TIMESTAMPTZ(6),
    "last_error" TEXT,

    CONSTRAINT "event_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "local_sessions" (
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

-- CreateTable
CREATE TABLE "profile_cache" (
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

-- CreateTable
CREATE TABLE "processed_events" (
    "event_id" UUID NOT NULL,
    "application_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" TEXT NOT NULL,
    "action" TEXT,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("application_id","event_id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" UUID NOT NULL,
    "application_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "request_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "groups_name_key" ON "groups"("name");

-- CreateIndex
CREATE UNIQUE INDEX "user_groups_user_id_group_id_key" ON "user_groups"("user_id", "group_id");

-- CreateIndex
CREATE UNIQUE INDEX "applications_client_id_key" ON "applications"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "application_redirect_uris_application_id_redirect_uri_key" ON "application_redirect_uris"("application_id", "redirect_uri");

-- CreateIndex
CREATE UNIQUE INDEX "application_group_policies_application_id_group_id_effect_key" ON "application_group_policies"("application_id", "group_id", "effect");

-- CreateIndex
CREATE UNIQUE INDEX "sso_sessions_session_token_hash_key" ON "sso_sessions"("session_token_hash");

-- CreateIndex
CREATE INDEX "sso_sessions_user_id_status_idx" ON "sso_sessions"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "authorization_codes_code_hash_key" ON "authorization_codes"("code_hash");

-- CreateIndex
CREATE INDEX "authorization_codes_application_id_expires_at_idx" ON "authorization_codes"("application_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "access_tokens_token_hash_key" ON "access_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "access_tokens_application_id_status_idx" ON "access_tokens"("application_id", "status");

-- CreateIndex
CREATE INDEX "audit_logs_event_type_created_at_idx" ON "audit_logs"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "events_status_created_at_idx" ON "events"("status", "created_at");

-- CreateIndex
CREATE INDEX "event_deliveries_status_next_retry_at_idx" ON "event_deliveries"("status", "next_retry_at");

-- CreateIndex
CREATE UNIQUE INDEX "event_deliveries_event_id_application_id_key" ON "event_deliveries"("event_id", "application_id");

-- CreateIndex
CREATE UNIQUE INDEX "local_sessions_session_token_hash_key" ON "local_sessions"("session_token_hash");

-- CreateIndex
CREATE INDEX "local_sessions_application_id_external_user_id_status_idx" ON "local_sessions"("application_id", "external_user_id", "status");

-- CreateIndex
CREATE INDEX "local_sessions_application_id_central_session_id_idx" ON "local_sessions"("application_id", "central_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "profile_cache_application_id_external_user_id_key" ON "profile_cache"("application_id", "external_user_id");

-- CreateIndex
CREATE INDEX "activity_logs_application_id_created_at_idx" ON "activity_logs"("application_id", "created_at");

-- AddForeignKey
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_redirect_uris" ADD CONSTRAINT "application_redirect_uris_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_group_policies" ADD CONSTRAINT "application_group_policies_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_group_policies" ADD CONSTRAINT "application_group_policies_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sso_sessions" ADD CONSTRAINT "sso_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorization_codes" ADD CONSTRAINT "authorization_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorization_codes" ADD CONSTRAINT "authorization_codes_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorization_codes" ADD CONSTRAINT "authorization_codes_sso_session_id_fkey" FOREIGN KEY ("sso_session_id") REFERENCES "sso_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_tokens" ADD CONSTRAINT "access_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_tokens" ADD CONSTRAINT "access_tokens_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_tokens" ADD CONSTRAINT "access_tokens_sso_session_id_fkey" FOREIGN KEY ("sso_session_id") REFERENCES "sso_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_central_session_id_fkey" FOREIGN KEY ("central_session_id") REFERENCES "sso_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_deliveries" ADD CONSTRAINT "event_deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_deliveries" ADD CONSTRAINT "event_deliveries_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
