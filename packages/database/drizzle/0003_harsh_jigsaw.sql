CREATE TABLE "crossword_cells" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"cell_id" uuid NOT NULL,
	"value" text NOT NULL,
	"elapsed_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "crossword_cells_value_check" CHECK (char_length("crossword_cells"."value") >= 1 and char_length("crossword_cells"."value") <= 2),
	CONSTRAINT "crossword_cells_elapsed_check" CHECK ("crossword_cells"."elapsed_ms" >= 0 and "crossword_cells"."elapsed_ms" <= 3600000)
);
--> statement-breakpoint
ALTER TABLE "attempt_events" DROP CONSTRAINT "attempt_events_type_check";--> statement-breakpoint
ALTER TABLE "crossword_cells" ADD CONSTRAINT "crossword_cells_attempt_id_game_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."game_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crossword_cells_attempt_cell_uidx" ON "crossword_cells" USING btree ("attempt_id","cell_id");--> statement-breakpoint
ALTER TABLE "attempt_events" ADD CONSTRAINT "attempt_events_type_check" CHECK ("attempt_events"."event_type" in ('answer_selected','cell_set','hint_revealed'));