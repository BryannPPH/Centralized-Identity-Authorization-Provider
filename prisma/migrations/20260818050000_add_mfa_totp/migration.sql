CREATE TYPE "MfaChallengeStatus" AS ENUM ('pending', 'used', 'expired');

CREATE TABLE "mfa_totp_credentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "secret_encrypted" TEXT NOT NULL,
    "enabled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mfa_totp_credentials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mfa_challenges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "challenge_token_hash" TEXT NOT NULL,
    "status" "MfaChallengeStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "ip_address" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "mfa_challenges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mfa_totp_credentials_user_id_key" ON "mfa_totp_credentials"("user_id");
CREATE UNIQUE INDEX "mfa_challenges_challenge_token_hash_key" ON "mfa_challenges"("challenge_token_hash");
CREATE INDEX "mfa_challenges_user_id_status_idx" ON "mfa_challenges"("user_id", "status");
CREATE INDEX "mfa_challenges_status_expires_at_idx" ON "mfa_challenges"("status", "expires_at");

ALTER TABLE "mfa_totp_credentials"
ADD CONSTRAINT "mfa_totp_credentials_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mfa_challenges"
ADD CONSTRAINT "mfa_challenges_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
