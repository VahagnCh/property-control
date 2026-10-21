-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "membership_role" AS ENUM ('owner', 'member', 'viewer');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('active', 'invited', 'revoked');

-- CreateEnum
CREATE TYPE "obligation_category" AS ENUM ('predial', 'water', 'electricity', 'gas', 'internet', 'mantenimiento', 'mortgage', 'insurance', 'security', 'other');

-- CreateEnum
CREATE TYPE "obligation_cadence" AS ENUM ('monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual', 'custom', 'irregular');

-- CreateEnum
CREATE TYPE "property_type" AS ENUM ('house', 'apartment', 'land', 'commercial', 'other');

-- CreateEnum
CREATE TYPE "occupancy_status" AS ENUM ('owned', 'rented', 'family', 'investment');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('recorded', 'voided');

-- CreateEnum
CREATE TYPE "period_outcome" AS ENUM ('paid', 'partial', 'not_applicable');

-- CreateEnum
CREATE TYPE "evidence_type" AS ENUM ('photo', 'screenshot', 'pdf');

-- CreateEnum
CREATE TYPE "evidence_status" AS ENUM ('pending', 'attached');

-- CreateEnum
CREATE TYPE "maintenance_status" AS ENUM ('open', 'in_progress', 'done', 'cancelled');

-- CreateEnum
CREATE TYPE "reminder_channel" AS ENUM ('email', 'push', 'in_app');

-- CreateEnum
CREATE TYPE "reminder_status" AS ENUM ('pending', 'sent', 'cancelled', 'failed');

-- CreateEnum
CREATE TYPE "ocr_job_status" AS ENUM ('pending', 'processing', 'suggested', 'confirmed', 'rejected', 'failed');

-- CreateEnum
CREATE TYPE "ocr_target_entity_type" AS ENUM ('obligation', 'payment', 'property', 'document_meta');

-- CreateEnum
CREATE TYPE "ocr_apply_status" AS ENUM ('pending', 'accepted', 'rejected');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "trust_sub" TEXT NOT NULL,
    "email" TEXT,
    "display_name" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "property_type" "property_type" NOT NULL DEFAULT 'other',
    "occupancy_status" "occupancy_status",
    "address_line" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT NOT NULL DEFAULT 'MX',
    "postal_code" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Mexico_City',
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_memberships" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "membership_role" NOT NULL DEFAULT 'viewer',
    "status" "membership_status" NOT NULL DEFAULT 'active',
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "property_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obligations" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "category" "obligation_category" NOT NULL,
    "title" TEXT NOT NULL,
    "provider_name" TEXT,
    "recurrence" "obligation_cadence" NOT NULL DEFAULT 'monthly',
    "due_day" INTEGER,
    "schedule_anchor" DATE,
    "next_due_date" DATE,
    "expected_amount" INTEGER,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'MXN',
    "reminder_offsets" INTEGER[] DEFAULT ARRAY[7, 1]::INTEGER[],
    "preferred_method" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "obligation_id" UUID NOT NULL,
    "period_due_date" DATE NOT NULL,
    "recorded_by_user_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'MXN',
    "paid_at" TIMESTAMPTZ(6) NOT NULL,
    "method" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "status" "payment_status" NOT NULL DEFAULT 'recorded',
    "idempotency_key" TEXT NOT NULL,
    "voided_at" TIMESTAMPTZ(6),
    "voided_by" UUID,
    "void_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obligation_period_outcomes" (
    "id" UUID NOT NULL,
    "obligation_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "period_due_date" DATE NOT NULL,
    "outcome" "period_outcome" NOT NULL,
    "payment_id" UUID,
    "overpaid_amount" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "obligation_period_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obligation_pause_intervals" (
    "id" UUID NOT NULL,
    "obligation_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "paused_on" DATE NOT NULL,
    "resumed_on" DATE,
    "last_scheduled_due_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "obligation_pause_intervals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "payment_id" UUID,
    "maintenance_task_id" UUID,
    "uploaded_by_user_id" UUID NOT NULL,
    "source_key" TEXT NOT NULL,
    "status" "evidence_status" NOT NULL DEFAULT 'pending',
    "type" "evidence_type" NOT NULL,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "content_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "original_filename" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_tasks" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "maintenance_status" NOT NULL DEFAULT 'open',
    "due_on" DATE,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "maintenance_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "uploaded_by_user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "byte_size" BIGINT NOT NULL,
    "original_filename" TEXT,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "obligation_id" UUID,
    "maintenance_task_id" UUID,
    "period_due_date" DATE,
    "scheduled_for" TIMESTAMPTZ(6) NOT NULL,
    "channel" "reminder_channel" NOT NULL DEFAULT 'in_app',
    "status" "reminder_status" NOT NULL DEFAULT 'pending',
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "reminder_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "scheduled_for" TIMESTAMPTZ(6) NOT NULL,
    "channel" "reminder_channel" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_invites" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "membership_role" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by_user_id" UUID NOT NULL,
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "property_id" UUID,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "before_state" JSONB,
    "after_state" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocr_jobs" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "evidence_id" UUID,
    "status" "ocr_job_status" NOT NULL DEFAULT 'pending',
    "source_key" TEXT NOT NULL,
    "vendor" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ocr_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocr_suggestions" (
    "id" UUID NOT NULL,
    "ocr_job_id" UUID NOT NULL,
    "target_entity_type" "ocr_target_entity_type" NOT NULL,
    "target_entity_id" UUID,
    "field_path" TEXT NOT NULL,
    "suggested_value" JSONB NOT NULL,
    "confidence" DECIMAL(5,4),
    "user_edited_value" JSONB,
    "apply_status" "ocr_apply_status" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ocr_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "route_key" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aviso_versions" (
    "version" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "text_sha256" TEXT NOT NULL,
    "published_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aviso_versions_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "aviso_version" TEXT NOT NULL,
    "accepted_at" TIMESTAMPTZ(6) NOT NULL,
    "app_version" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "replaced_by_id" UUID,
    "grace_refresh_token" TEXT,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_code_attempts" (
    "id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "attempted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_code_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "id" UUID NOT NULL,
    "bucket_key" TEXT NOT NULL,
    "window_started_at" TIMESTAMPTZ(6) NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "blocked_until" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_trust_sub_key" ON "users"("trust_sub");

-- CreateIndex
CREATE INDEX "property_memberships_user_id_idx" ON "property_memberships"("user_id");

-- CreateIndex
CREATE INDEX "property_memberships_property_id_idx" ON "property_memberships"("property_id");

-- CreateIndex
CREATE UNIQUE INDEX "property_memberships_property_id_user_id_key" ON "property_memberships"("property_id", "user_id");

-- CreateIndex
CREATE INDEX "obligations_property_id_idx" ON "obligations"("property_id");

-- CreateIndex
CREATE INDEX "obligations_property_id_category_idx" ON "obligations"("property_id", "category");

-- CreateIndex
CREATE INDEX "payments_obligation_id_period_due_date_idx" ON "payments"("obligation_id", "period_due_date");

-- CreateIndex
CREATE INDEX "payments_property_id_paid_at_idx" ON "payments"("property_id", "paid_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_property_id_idempotency_key_key" ON "payments"("property_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "obligation_period_outcomes_property_id_period_due_date_idx" ON "obligation_period_outcomes"("property_id", "period_due_date");

-- CreateIndex
CREATE UNIQUE INDEX "obligation_period_outcomes_obligation_id_period_due_date_key" ON "obligation_period_outcomes"("obligation_id", "period_due_date");

-- CreateIndex
CREATE INDEX "obligation_pause_intervals_obligation_id_idx" ON "obligation_pause_intervals"("obligation_id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_source_key_key" ON "evidence"("source_key");

-- CreateIndex
CREATE INDEX "evidence_payment_id_idx" ON "evidence"("payment_id");

-- CreateIndex
CREATE INDEX "evidence_maintenance_task_id_idx" ON "evidence"("maintenance_task_id");

-- CreateIndex
CREATE INDEX "evidence_property_id_idx" ON "evidence"("property_id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_property_id_idempotency_key_key" ON "evidence"("property_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "maintenance_tasks_property_id_idx" ON "maintenance_tasks"("property_id");

-- CreateIndex
CREATE UNIQUE INDEX "documents_source_key_key" ON "documents"("source_key");

-- CreateIndex
CREATE INDEX "documents_property_id_idx" ON "documents"("property_id");

-- CreateIndex
CREATE INDEX "reminders_scheduled_for_idx" ON "reminders"("scheduled_for");

-- CreateIndex
CREATE INDEX "reminders_property_id_idx" ON "reminders"("property_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_idempotency_key" ON "notification_deliveries"("reminder_id", "scheduled_for", "user_id", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "membership_invites_token_hash_key" ON "membership_invites"("token_hash");

-- CreateIndex
CREATE INDEX "membership_invites_property_id_email_idx" ON "membership_invites"("property_id", "email");

-- CreateIndex
CREATE INDEX "audit_events_property_id_created_at_idx" ON "audit_events"("property_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_entity_type_entity_id_idx" ON "audit_events"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "ocr_jobs_property_id_created_at_idx" ON "ocr_jobs"("property_id", "created_at");

-- CreateIndex
CREATE INDEX "ocr_jobs_document_id_idx" ON "ocr_jobs"("document_id");

-- CreateIndex
CREATE INDEX "ocr_jobs_status_idx" ON "ocr_jobs"("status");

-- CreateIndex
CREATE INDEX "ocr_suggestions_ocr_job_id_idx" ON "ocr_suggestions"("ocr_job_id");

-- CreateIndex
CREATE INDEX "ocr_suggestions_ocr_job_id_apply_status_idx" ON "ocr_suggestions"("ocr_job_id", "apply_status");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_property_id_route_key_idempotency_key_key" ON "idempotency_records"("property_id", "route_key", "idempotency_key");

-- CreateIndex
CREATE INDEX "consents_user_id_idx" ON "consents"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "consents_user_id_aviso_version_key" ON "consents"("user_id", "aviso_version");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_replaced_by_id_key" ON "refresh_tokens"("replaced_by_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_user_id_key_key" ON "idempotency_keys"("user_id", "key");

-- CreateIndex
CREATE INDEX "auth_code_attempts_subject_purpose_attempted_at_idx" ON "auth_code_attempts"("subject", "purpose", "attempted_at");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limits_bucket_key_key" ON "rate_limits"("bucket_key");

-- AddForeignKey
ALTER TABLE "property_memberships" ADD CONSTRAINT "property_memberships_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_memberships" ADD CONSTRAINT "property_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_obligation_id_fkey" FOREIGN KEY ("obligation_id") REFERENCES "obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_period_outcomes" ADD CONSTRAINT "obligation_period_outcomes_obligation_id_fkey" FOREIGN KEY ("obligation_id") REFERENCES "obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_period_outcomes" ADD CONSTRAINT "obligation_period_outcomes_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_period_outcomes" ADD CONSTRAINT "obligation_period_outcomes_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_pause_intervals" ADD CONSTRAINT "obligation_pause_intervals_obligation_id_fkey" FOREIGN KEY ("obligation_id") REFERENCES "obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_pause_intervals" ADD CONSTRAINT "obligation_pause_intervals_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_maintenance_task_id_fkey" FOREIGN KEY ("maintenance_task_id") REFERENCES "maintenance_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_tasks" ADD CONSTRAINT "maintenance_tasks_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_obligation_id_fkey" FOREIGN KEY ("obligation_id") REFERENCES "obligations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_maintenance_task_id_fkey" FOREIGN KEY ("maintenance_task_id") REFERENCES "maintenance_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_reminder_id_fkey" FOREIGN KEY ("reminder_id") REFERENCES "reminders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_invites" ADD CONSTRAINT "membership_invites_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_invites" ADD CONSTRAINT "membership_invites_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_jobs" ADD CONSTRAINT "ocr_jobs_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_jobs" ADD CONSTRAINT "ocr_jobs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_jobs" ADD CONSTRAINT "ocr_jobs_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_suggestions" ADD CONSTRAINT "ocr_suggestions_ocr_job_id_fkey" FOREIGN KEY ("ocr_job_id") REFERENCES "ocr_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_aviso_version_fkey" FOREIGN KEY ("aviso_version") REFERENCES "aviso_versions"("version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Checks, partial unique indexes, and append-only consent triggers.
-- Checks and partial unique indexes Prisma cannot express.
-- The first migration runs this file after the Prisma tables exist.
-- Names and predicates are the contract in docs/EDGE_CASES.md.

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_amount_positive;
ALTER TABLE payments
  ADD CONSTRAINT payments_amount_positive CHECK (amount > 0);

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_currency_mxn;
ALTER TABLE payments
  ADD CONSTRAINT payments_currency_mxn CHECK (currency = 'MXN');

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_void_fields_match_status;
ALTER TABLE payments
  ADD CONSTRAINT payments_void_fields_match_status CHECK (
    (
      status = 'voided'
      AND voided_at IS NOT NULL
      AND voided_by IS NOT NULL
      AND void_reason IS NOT NULL
    )
    OR (
      status = 'recorded'
      AND voided_at IS NULL
      AND voided_by IS NULL
      AND void_reason IS NULL
    )
  );

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_void_reason_length;
ALTER TABLE payments
  ADD CONSTRAINT payments_void_reason_length CHECK (
    void_reason IS NULL
    OR char_length(btrim(void_reason)) BETWEEN 1 AND 500
  );

ALTER TABLE obligations
  DROP CONSTRAINT IF EXISTS obligations_next_due_date_sanity;
ALTER TABLE obligations
  ADD CONSTRAINT obligations_next_due_date_sanity CHECK (
    next_due_date IS NULL
    OR (
      next_due_date >= DATE '1990-01-01'
      AND next_due_date <= DATE '2100-12-31'
    )
  );

ALTER TABLE obligations
  DROP CONSTRAINT IF EXISTS obligations_currency_mxn;
ALTER TABLE obligations
  ADD CONSTRAINT obligations_currency_mxn CHECK (currency = 'MXN');

ALTER TABLE obligations
  DROP CONSTRAINT IF EXISTS obligations_due_day_range;
ALTER TABLE obligations
  ADD CONSTRAINT obligations_due_day_range CHECK (
    due_day IS NULL OR (due_day >= 1 AND due_day <= 31)
  );

ALTER TABLE obligations
  DROP CONSTRAINT IF EXISTS obligations_anchor_requires_due_day;
ALTER TABLE obligations
  ADD CONSTRAINT obligations_anchor_requires_due_day CHECK (
    (due_day IS NULL AND schedule_anchor IS NULL)
    OR (due_day IS NOT NULL AND schedule_anchor IS NOT NULL)
  );

ALTER TABLE obligation_period_outcomes
  DROP CONSTRAINT IF EXISTS obligation_period_outcomes_overpaid_nonnegative;
ALTER TABLE obligation_period_outcomes
  ADD CONSTRAINT obligation_period_outcomes_overpaid_nonnegative CHECK (overpaid_amount >= 0);

ALTER TABLE obligation_period_outcomes
  DROP CONSTRAINT IF EXISTS obligation_period_outcomes_not_applicable_has_no_payment;
ALTER TABLE obligation_period_outcomes
  ADD CONSTRAINT obligation_period_outcomes_not_applicable_has_no_payment CHECK (
    outcome <> 'not_applicable' OR payment_id IS NULL
  );

ALTER TABLE obligation_pause_intervals
  DROP CONSTRAINT IF EXISTS obligation_pause_intervals_resume_on_or_after_pause;
ALTER TABLE obligation_pause_intervals
  ADD CONSTRAINT obligation_pause_intervals_resume_on_or_after_pause CHECK (
    resumed_on IS NULL OR resumed_on >= paused_on
  );

ALTER TABLE evidence
  DROP CONSTRAINT IF EXISTS evidence_one_parent;
ALTER TABLE evidence
  ADD CONSTRAINT evidence_one_parent CHECK (
    (payment_id IS NOT NULL AND maintenance_task_id IS NULL)
    OR (payment_id IS NULL AND maintenance_task_id IS NOT NULL)
  );

ALTER TABLE evidence
  DROP CONSTRAINT IF EXISTS evidence_content_type_allowlist;
ALTER TABLE evidence
  ADD CONSTRAINT evidence_content_type_allowlist CHECK (
    content_type IN ('image/jpeg', 'image/png', 'application/pdf')
  );

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_content_type_allowlist;
ALTER TABLE documents
  ADD CONSTRAINT documents_content_type_allowlist CHECK (
    content_type IN ('image/jpeg', 'image/png', 'application/pdf')
  );

ALTER TABLE evidence
  DROP CONSTRAINT IF EXISTS evidence_byte_size_cap;
ALTER TABLE evidence
  ADD CONSTRAINT evidence_byte_size_cap CHECK (
    size_bytes > 0 AND size_bytes <= 10485760
  );

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_byte_size_cap;
ALTER TABLE documents
  ADD CONSTRAINT documents_byte_size_cap CHECK (
    byte_size > 0 AND byte_size <= 10485760
  );

ALTER TABLE reminders
  DROP CONSTRAINT IF EXISTS reminders_one_parent;
ALTER TABLE reminders
  ADD CONSTRAINT reminders_one_parent CHECK (
    (obligation_id IS NOT NULL AND maintenance_task_id IS NULL)
    OR (obligation_id IS NULL AND maintenance_task_id IS NOT NULL)
  );

DROP INDEX IF EXISTS reminders_obligation_id_scheduled_for_channel_key;
CREATE UNIQUE INDEX reminders_obligation_id_scheduled_for_channel_key
  ON reminders (obligation_id, scheduled_for, channel)
  WHERE obligation_id IS NOT NULL;

DROP INDEX IF EXISTS reminders_maintenance_task_id_scheduled_for_channel_key;
CREATE UNIQUE INDEX reminders_maintenance_task_id_scheduled_for_channel_key
  ON reminders (maintenance_task_id, scheduled_for, channel)
  WHERE maintenance_task_id IS NOT NULL;

ALTER TABLE membership_invites
  DROP CONSTRAINT IF EXISTS membership_invites_role_not_owner;
ALTER TABLE membership_invites
  ADD CONSTRAINT membership_invites_role_not_owner CHECK (
    role IN ('member', 'viewer')
  );

ALTER TABLE refresh_tokens
  DROP CONSTRAINT IF EXISTS refresh_tokens_absolute_cap;
ALTER TABLE refresh_tokens
  ADD CONSTRAINT refresh_tokens_absolute_cap CHECK (
    absolute_expires_at >= issued_at
    AND expires_at >= issued_at
    AND expires_at <= absolute_expires_at
    AND absolute_expires_at <= issued_at + interval '90 days'
  );

ALTER TABLE rate_limits
  DROP CONSTRAINT IF EXISTS rate_limits_attempt_count_nonnegative;
ALTER TABLE rate_limits
  ADD CONSTRAINT rate_limits_attempt_count_nonnegative CHECK (attempt_count >= 0);

-- plpgsql is built in. This is not an extension.
CREATE OR REPLACE FUNCTION consents_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'consents are append-only';
END;
$$;

DROP TRIGGER IF EXISTS consents_append_only_update ON consents;
CREATE TRIGGER consents_append_only_update
  BEFORE UPDATE ON consents
  FOR EACH ROW
  EXECUTE FUNCTION consents_reject_mutation();

DROP TRIGGER IF EXISTS consents_append_only_delete ON consents;
CREATE TRIGGER consents_append_only_delete
  BEFORE DELETE ON consents
  FOR EACH ROW
  EXECUTE FUNCTION consents_reject_mutation();

-- UUID defaults use core gen_random_uuid() (PostgreSQL 13+). No extension.

ALTER TABLE users ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE properties ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE property_memberships ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE obligations ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE payments ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE obligation_period_outcomes ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE obligation_pause_intervals ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE evidence ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE maintenance_tasks ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE documents ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE reminders ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE notification_deliveries ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE membership_invites ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE audit_events ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE ocr_jobs ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE ocr_suggestions ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE idempotency_records ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE consents ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE refresh_tokens ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE idempotency_keys ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE auth_code_attempts ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE rate_limits ALTER COLUMN id SET DEFAULT gen_random_uuid();
