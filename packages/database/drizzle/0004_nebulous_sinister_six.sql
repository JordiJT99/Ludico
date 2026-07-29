CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_provider" text NOT NULL,
	"external_subject" text NOT NULL,
	"email_normalized" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD COLUMN "migrated_user_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "users_provider_subject_uidx" ON "users" USING btree ("auth_provider","external_subject");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_active_uidx" ON "users" USING btree ("email_normalized") WHERE "users"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "game_attempts" ADD CONSTRAINT "game_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD CONSTRAINT "guest_sessions_migrated_user_id_users_id_fk" FOREIGN KEY ("migrated_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;