CREATE TABLE "word_bank_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"locale" text DEFAULT 'es-ES' NOT NULL,
	"answer" text NOT NULL,
	"normalized_answer" text NOT NULL,
	"clue" text NOT NULL,
	"clue_hash" text NOT NULL,
	"source_url" text NOT NULL,
	"source_checked_at" timestamp with time zone NOT NULL,
	"quality_score" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "word_bank_answer_length_check" CHECK (char_length("word_bank_entries"."normalized_answer") between 2 and 21),
	CONSTRAINT "word_bank_quality_check" CHECK ("word_bank_entries"."quality_score" between 0 and 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "word_bank_active_answer_clue_uidx" ON "word_bank_entries" USING btree ("locale","normalized_answer","clue_hash") WHERE "word_bank_entries"."active" = true;--> statement-breakpoint
CREATE INDEX "word_bank_locale_quality_idx" ON "word_bank_entries" USING btree ("locale","active","quality_score");