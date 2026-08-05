CREATE TABLE "word_search_finds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"elapsed_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "word_search_finds_elapsed_check" CHECK ("word_search_finds"."elapsed_ms" >= 0 and "word_search_finds"."elapsed_ms" <= 3600000)
);
--> statement-breakpoint
ALTER TABLE "attempt_events" DROP CONSTRAINT "attempt_events_type_check";--> statement-breakpoint
ALTER TABLE "games" DROP CONSTRAINT "games_type_check";--> statement-breakpoint
ALTER TABLE "word_search_finds" ADD CONSTRAINT "word_search_finds_attempt_id_game_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."game_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "word_search_finds_attempt_entry_uidx" ON "word_search_finds" USING btree ("attempt_id","entry_id");--> statement-breakpoint
ALTER TABLE "attempt_events" ADD CONSTRAINT "attempt_events_type_check" CHECK ("attempt_events"."event_type" in ('answer_selected','cell_set','hint_revealed','word_guessed','word_found'));--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_type_check" CHECK ("games"."type" in ('quiz','crossword','true_false','guess_word','word_search'));