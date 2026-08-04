CREATE TABLE "word_guesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"guess" text NOT NULL,
	"elapsed_ms" integer NOT NULL,
	"is_correct" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "word_guesses_guess_check" CHECK (char_length("word_guesses"."guess") >= 1 and char_length("word_guesses"."guess") <= 21),
	CONSTRAINT "word_guesses_elapsed_check" CHECK ("word_guesses"."elapsed_ms" >= 0 and "word_guesses"."elapsed_ms" <= 3600000)
);
--> statement-breakpoint
ALTER TABLE "attempt_events" DROP CONSTRAINT "attempt_events_type_check";--> statement-breakpoint
ALTER TABLE "games" DROP CONSTRAINT "games_type_check";--> statement-breakpoint
ALTER TABLE "word_guesses" ADD CONSTRAINT "word_guesses_attempt_id_game_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."game_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "word_guesses_attempt_created_idx" ON "word_guesses" USING btree ("attempt_id","created_at");--> statement-breakpoint
ALTER TABLE "attempt_events" ADD CONSTRAINT "attempt_events_type_check" CHECK ("attempt_events"."event_type" in ('answer_selected','cell_set','hint_revealed','word_guessed'));--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_type_check" CHECK ("games"."type" in ('quiz','crossword','true_false','guess_word'));