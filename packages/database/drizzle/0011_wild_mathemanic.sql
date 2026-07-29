ALTER TABLE "word_bank_entries" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "word_bank_entries" ADD COLUMN "difficulty" integer;--> statement-breakpoint
ALTER TABLE "word_bank_entries" ADD COLUMN "letter_count" integer;--> statement-breakpoint
ALTER TABLE "word_bank_entries" ADD COLUMN "variants" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "word_bank_entries" ADD COLUMN "validation_status" text;--> statement-breakpoint
UPDATE "word_bank_entries"
SET "category" = 'General',
    "difficulty" = 3,
    "letter_count" = char_length("normalized_answer"),
    "validation_status" = CASE WHEN "quality_score" >= 70 THEN 'approved' ELSE 'pending' END;--> statement-breakpoint
ALTER TABLE "word_bank_entries" ALTER COLUMN "category" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "word_bank_entries" ALTER COLUMN "difficulty" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "word_bank_entries" ALTER COLUMN "letter_count" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "word_bank_entries" ALTER COLUMN "validation_status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "word_bank_entries" ADD CONSTRAINT "word_bank_difficulty_check" CHECK ("word_bank_entries"."difficulty" between 1 and 5);--> statement-breakpoint
ALTER TABLE "word_bank_entries" ADD CONSTRAINT "word_bank_letter_count_check" CHECK ("word_bank_entries"."letter_count" between 2 and 21);--> statement-breakpoint
ALTER TABLE "word_bank_entries" ADD CONSTRAINT "word_bank_validation_status_check" CHECK ("word_bank_entries"."validation_status" in ('pending','approved','rejected'));
