ALTER TABLE "games" DROP CONSTRAINT "games_type_check";--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_type_check" CHECK ("games"."type" in ('quiz','crossword','true_false'));