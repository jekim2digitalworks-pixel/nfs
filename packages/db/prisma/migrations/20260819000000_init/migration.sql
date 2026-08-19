-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "category_tag" AS ENUM ('DEVELOPMENT', 'MEETING', 'STUDY', 'FAMILY', 'HEALTH', 'PERSONAL', 'CHORE', 'UNCATEGORIZED');

-- CreateEnum
CREATE TYPE "block_status" AS ENUM ('READY', 'RUNNING', 'PAUSED');

-- CreateEnum
CREATE TYPE "source_type" AS ENUM ('NFS_BLOCK', 'GOOGLE_CALENDAR');

-- CreateEnum
CREATE TYPE "completion_type" AS ENUM ('NORMAL_COMPLETED', 'EARLY_FINISHED', 'AUTO_SETTLED', 'ABANDONED', 'CALENDAR_IMPORTED');

-- CreateEnum
CREATE TYPE "google_scope_level" AS ENUM ('NONE', 'READ_ONLY', 'READ_WRITE');

-- CreateEnum
CREATE TYPE "closing_status" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "calendar_sync_result" AS ENUM ('SYNCED', 'FAILED', 'NOT_CONNECTED');

-- CreateTable
CREATE TABLE "member" (
    "member_id" BIGSERIAL NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "google_user_id" VARCHAR(64),
    "google_refresh_token" VARCHAR(512),
    "google_scope_level" "google_scope_level" NOT NULL DEFAULT 'NONE',
    "calendar_backfilled" BOOLEAN NOT NULL DEFAULT false,
    "created_time" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_pkey" PRIMARY KEY ("member_id")
);

-- CreateTable
CREATE TABLE "active_block" (
    "active_block_id" BIGSERIAL NOT NULL,
    "member_id" BIGINT NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "category_tag" "category_tag" NOT NULL,
    "block_status" "block_status" NOT NULL DEFAULT 'READY',
    "planned_start_time" TIMESTAMPTZ(0) NOT NULL,
    "planned_minutes" INTEGER NOT NULL,
    "actual_start_time" TIMESTAMPTZ(0),
    "accumulated_focus_seconds" INTEGER NOT NULL DEFAULT 0,
    "last_resumed_time" TIMESTAMPTZ(0),
    "pause_count" INTEGER NOT NULL DEFAULT 0,
    "work_date" DATE NOT NULL,
    "created_time" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "active_block_pkey" PRIMARY KEY ("active_block_id")
);

-- CreateTable
CREATE TABLE "imported_calendar_event" (
    "imported_event_id" BIGSERIAL NOT NULL,
    "member_id" BIGINT NOT NULL,
    "google_calendar_id" VARCHAR(255) NOT NULL,
    "google_event_id" VARCHAR(255) NOT NULL,
    "google_etag" VARCHAR(128),
    "title" VARCHAR(200) NOT NULL,
    "google_color_id" VARCHAR(10),
    "mapped_category_tag" "category_tag" NOT NULL,
    "start_time" TIMESTAMPTZ(0) NOT NULL,
    "end_time" TIMESTAMPTZ(0) NOT NULL,
    "week_start_date" DATE NOT NULL,
    "excluded_from_statistics" BOOLEAN NOT NULL DEFAULT false,
    "exclusion_reason" VARCHAR(30),
    "last_synced_time" TIMESTAMPTZ(0) NOT NULL,

    CONSTRAINT "imported_calendar_event_pkey" PRIMARY KEY ("imported_event_id")
);

-- CreateTable
CREATE TABLE "time_log" (
    "time_log_id" BIGSERIAL NOT NULL,
    "member_id" BIGINT NOT NULL,
    "source_type" "source_type" NOT NULL,
    "source_reference_key" VARCHAR(255) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "category_tag" "category_tag" NOT NULL,
    "stat_date" DATE NOT NULL,
    "start_time" TIMESTAMPTZ(0) NOT NULL,
    "end_time" TIMESTAMPTZ(0) NOT NULL,
    "planned_minutes" INTEGER NOT NULL,
    "actual_focus_minutes" INTEGER NOT NULL,
    "overlap_deducted_minutes" INTEGER NOT NULL DEFAULT 0,
    "completion_type" "completion_type" NOT NULL,
    "pause_count" INTEGER NOT NULL DEFAULT 0,
    "created_time" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "time_log_pkey" PRIMARY KEY ("time_log_id")
);

-- CreateTable
CREATE TABLE "weekly_closing" (
    "weekly_closing_id" BIGSERIAL NOT NULL,
    "member_id" BIGINT NOT NULL,
    "week_start_date" DATE NOT NULL,
    "closing_status" "closing_status" NOT NULL DEFAULT 'OPEN',
    "closed_time" TIMESTAMPTZ(0),
    "calendar_sync_result" "calendar_sync_result" NOT NULL DEFAULT 'NOT_CONNECTED',
    "last_synced_time" TIMESTAMPTZ(0),
    "imported_event_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "weekly_closing_pkey" PRIMARY KEY ("weekly_closing_id")
);

-- CreateTable
CREATE TABLE "category_color_mapping" (
    "mapping_id" BIGSERIAL NOT NULL,
    "member_id" BIGINT NOT NULL,
    "google_color_id" VARCHAR(10) NOT NULL,
    "category_tag" "category_tag" NOT NULL,

    CONSTRAINT "category_color_mapping_pkey" PRIMARY KEY ("mapping_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "member_email_key" ON "member"("email");

-- CreateIndex
CREATE UNIQUE INDEX "member_google_user_id_key" ON "member"("google_user_id");

-- CreateIndex
CREATE INDEX "idx_active_block_member" ON "active_block"("member_id");

-- CreateIndex
CREATE INDEX "idx_imported_member_week" ON "imported_calendar_event"("member_id", "week_start_date");

-- CreateIndex
CREATE UNIQUE INDEX "uk_imported_member_event" ON "imported_calendar_event"("member_id", "google_event_id");

-- CreateIndex
CREATE INDEX "idx_time_log_member_date" ON "time_log"("member_id", "stat_date");

-- CreateIndex
CREATE INDEX "idx_time_log_member_tag_date" ON "time_log"("member_id", "category_tag", "stat_date");

-- CreateIndex
CREATE UNIQUE INDEX "uk_time_log_source" ON "time_log"("member_id", "source_type", "source_reference_key");

-- CreateIndex
CREATE UNIQUE INDEX "uk_weekly_closing_member_week" ON "weekly_closing"("member_id", "week_start_date");

-- CreateIndex
CREATE UNIQUE INDEX "uk_color_mapping_member_color" ON "category_color_mapping"("member_id", "google_color_id");

-- AddForeignKey
ALTER TABLE "active_block" ADD CONSTRAINT "active_block_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member"("member_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imported_calendar_event" ADD CONSTRAINT "imported_calendar_event_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member"("member_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_log" ADD CONSTRAINT "time_log_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member"("member_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_closing" ADD CONSTRAINT "weekly_closing_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member"("member_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_color_mapping" ADD CONSTRAINT "category_color_mapping_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member"("member_id") ON DELETE CASCADE ON UPDATE CASCADE;

