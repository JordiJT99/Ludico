ALTER TABLE "scores" ADD COLUMN "duration_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "public_alias" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "leaderboard_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_duration_check" CHECK ("scores"."duration_ms" >= 0);