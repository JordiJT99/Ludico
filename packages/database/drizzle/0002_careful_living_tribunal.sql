CREATE TABLE "answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"selected_option_id" uuid NOT NULL,
	"elapsed_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "answers_elapsed_check" CHECK ("answers"."elapsed_ms" >= 0 and "answers"."elapsed_ms" <= 3600000)
);
--> statement-breakpoint
CREATE TABLE "attempt_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"client_event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"client_occurred_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attempt_events_type_check" CHECK ("attempt_events"."event_type" in ('answer_selected'))
);
--> statement-breakpoint
CREATE TABLE "game_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"guest_session_id" uuid,
	"user_id" uuid,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"mode" text DEFAULT 'competitive' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"server_received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "attempts_subject_xor_check" CHECK (("game_attempts"."guest_session_id" is not null) <> ("game_attempts"."user_id" is not null)),
	CONSTRAINT "attempts_status_check" CHECK ("game_attempts"."status" in ('in_progress','submitted','accepted','rejected','finalized')),
	CONSTRAINT "attempts_mode_check" CHECK ("game_attempts"."mode" in ('competitive','casual'))
);
--> statement-breakpoint
CREATE TABLE "scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"score_version" text NOT NULL,
	"competitive" boolean NOT NULL,
	"breakdown" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scores_points_check" CHECK ("scores"."points" >= 0)
);
--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_attempt_id_game_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."game_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_events" ADD CONSTRAINT "attempt_events_attempt_id_game_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."game_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_attempts" ADD CONSTRAINT "game_attempts_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_attempts" ADD CONSTRAINT "game_attempts_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_attempt_id_game_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."game_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "answers_attempt_question_uidx" ON "answers" USING btree ("attempt_id","question_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attempt_events_client_uidx" ON "attempt_events" USING btree ("attempt_id","client_event_id");--> statement-breakpoint
CREATE INDEX "attempt_events_received_idx" ON "attempt_events" USING btree ("attempt_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "attempts_guest_game_competitive_uidx" ON "game_attempts" USING btree ("game_id","guest_session_id") WHERE "game_attempts"."mode" = 'competitive' and "game_attempts"."guest_session_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "attempts_user_game_competitive_uidx" ON "game_attempts" USING btree ("game_id","user_id") WHERE "game_attempts"."mode" = 'competitive' and "game_attempts"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "attempts_status_started_idx" ON "game_attempts" USING btree ("status","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scores_attempt_uidx" ON "scores" USING btree ("attempt_id");