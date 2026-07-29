CREATE TABLE "guest_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"origin" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"previous_session_id" uuid,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "guest_sessions_status_check" CHECK ("guest_sessions"."status" in ('active','rotated','expired','migrated','revoked')),
	CONSTRAINT "guest_sessions_origin_check" CHECK ("guest_sessions"."origin" in ('web','android','ios'))
);
--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD CONSTRAINT "guest_sessions_previous_session_id_guest_sessions_id_fk" FOREIGN KEY ("previous_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guest_sessions_token_hash_uidx" ON "guest_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "guest_sessions_status_expiry_idx" ON "guest_sessions" USING btree ("status","expires_at");