CREATE TABLE "experience_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experience_transactions_kind_check" CHECK ("experience_transactions"."kind" in ('completion','daily_double')),
	CONSTRAINT "experience_transactions_amount_check" CHECK ("experience_transactions"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "experience_transactions" ADD CONSTRAINT "experience_transactions_attempt_id_game_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."game_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "experience_transactions_attempt_kind_uidx" ON "experience_transactions" USING btree ("attempt_id","kind");
--> statement-breakpoint
CREATE FUNCTION grant_attempt_experience() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  completed_types integer;
BEGIN
  IF coalesce((NEW.breakdown ->> 'completed')::boolean, false) = false THEN
    RETURN NEW;
  END IF;

  INSERT INTO experience_transactions (attempt_id, kind, amount)
  VALUES (NEW.attempt_id, 'completion', 100)
  ON CONFLICT (attempt_id, kind) DO NOTHING;

  SELECT count(DISTINCT other_game.type)::integer
    INTO completed_types
    FROM game_attempts source_attempt
    JOIN games source_game ON source_game.id = source_attempt.game_id
    JOIN game_attempts other_attempt
      ON other_attempt.user_id IS NOT DISTINCT FROM source_attempt.user_id
     AND other_attempt.guest_session_id IS NOT DISTINCT FROM source_attempt.guest_session_id
    JOIN games other_game ON other_game.id = other_attempt.game_id
    JOIN scores other_score ON other_score.attempt_id = other_attempt.id
   WHERE source_attempt.id = NEW.attempt_id
     AND other_game.edition_id = source_game.edition_id
     AND coalesce((other_score.breakdown ->> 'completed')::boolean, false);

  IF completed_types = 2 THEN
    INSERT INTO experience_transactions (attempt_id, kind, amount)
    VALUES (NEW.attempt_id, 'daily_double', 200)
    ON CONFLICT (attempt_id, kind) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER scores_grant_experience
AFTER INSERT ON scores
FOR EACH ROW EXECUTE FUNCTION grant_attempt_experience();
