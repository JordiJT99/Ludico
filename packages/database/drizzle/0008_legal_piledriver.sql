CREATE TABLE "blocked_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"normalized_term" text NOT NULL,
	"reason" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_generation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_type" text NOT NULL,
	"target_date" date NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"prompt_version" text DEFAULT 'v1' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"budget_micros" integer DEFAULT 0 NOT NULL,
	"cost_micros" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "content_jobs_type_check" CHECK ("content_generation_jobs"."content_type" in ('quiz','crossword')),
	CONSTRAINT "content_jobs_status_check" CHECK ("content_generation_jobs"."status" in ('queued','running','succeeded','failed')),
	CONSTRAINT "content_jobs_cost_check" CHECK ("content_generation_jobs"."budget_micros" >= 0 and "content_generation_jobs"."cost_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "generated_contents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"generation_job_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"target_date" date NOT NULL,
	"status" text NOT NULL,
	"public_payload" jsonb NOT NULL,
	"private_payload" jsonb NOT NULL,
	"sources" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"selected_edition_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "generated_content_type_check" CHECK ("generated_contents"."content_type" in ('quiz','crossword')),
	CONSTRAINT "generated_content_status_check" CHECK ("generated_contents"."status" in ('approved','pending_review','rejected','selected'))
);
--> statement-breakpoint
CREATE TABLE "validation_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"generated_content_id" uuid NOT NULL,
	"validator" text NOT NULL,
	"validator_version" text NOT NULL,
	"outcome" text NOT NULL,
	"details" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "validation_outcome_check" CHECK ("validation_results"."outcome" in ('passed','review','failed'))
);
--> statement-breakpoint
ALTER TABLE "generated_contents" ADD CONSTRAINT "generated_contents_generation_job_id_content_generation_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."content_generation_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_contents" ADD CONSTRAINT "generated_contents_selected_edition_id_daily_editions_id_fk" FOREIGN KEY ("selected_edition_id") REFERENCES "public"."daily_editions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_results" ADD CONSTRAINT "validation_results_generated_content_id_generated_contents_id_fk" FOREIGN KEY ("generated_content_id") REFERENCES "public"."generated_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "blocked_terms_normalized_uidx" ON "blocked_terms" USING btree ("normalized_term");--> statement-breakpoint
CREATE UNIQUE INDEX "content_jobs_type_date_uidx" ON "content_generation_jobs" USING btree ("content_type","target_date");--> statement-breakpoint
CREATE INDEX "content_jobs_status_target_idx" ON "content_generation_jobs" USING btree ("status","target_date");--> statement-breakpoint
CREATE INDEX "generated_content_status_target_idx" ON "generated_contents" USING btree ("status","target_date","content_type");--> statement-breakpoint
CREATE INDEX "generated_content_hash_idx" ON "generated_contents" USING btree ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "validation_content_validator_uidx" ON "validation_results" USING btree ("generated_content_id","validator","validator_version");