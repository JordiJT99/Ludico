CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text,
	"correlation_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_editions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market" text DEFAULT 'ES' NOT NULL,
	"local_date" date NOT NULL,
	"market_time_zone" text DEFAULT 'Europe/Madrid' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"opens_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "daily_editions_status_check" CHECK ("daily_editions"."status" in ('draft','validating','approved','scheduled','published','closed','archived','rejected','cancelled')),
	CONSTRAINT "daily_editions_window_check" CHECK ("daily_editions"."closes_at" > "daily_editions"."opens_at")
);
--> statement-breakpoint
CREATE TABLE "game_solutions" (
	"game_id" uuid PRIMARY KEY NOT NULL,
	"private_payload" jsonb NOT NULL,
	"public_payload" jsonb,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"public_payload" jsonb NOT NULL,
	"content_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "games_type_check" CHECK ("games"."type" in ('quiz','crossword')),
	CONSTRAINT "games_status_check" CHECK ("games"."status" in ('active','disabled'))
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_solutions" ADD CONSTRAINT "game_solutions_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_edition_id_daily_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."daily_editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_target_idx" ON "audit_logs" USING btree ("target_type","target_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_editions_market_date_active_uidx" ON "daily_editions" USING btree ("market","local_date") WHERE "daily_editions"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "daily_editions_status_opens_idx" ON "daily_editions" USING btree ("status","opens_at");--> statement-breakpoint
CREATE UNIQUE INDEX "games_edition_type_uidx" ON "games" USING btree ("edition_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_scope_key_uidx" ON "idempotency_records" USING btree ("scope","key");--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "outbox_events" USING btree ("published_at","occurred_at");