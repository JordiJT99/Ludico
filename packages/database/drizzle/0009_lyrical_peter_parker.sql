CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint_id" uuid,
	"edition_id" uuid NOT NULL,
	"use_case" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"deep_link" text NOT NULL,
	"provider_message_id" text,
	"error_code" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "notification_delivery_use_case_check" CHECK ("notification_deliveries"."use_case" in ('daily_digest','edition_available','previous_solution')),
	CONSTRAINT "notification_delivery_status_check" CHECK ("notification_deliveries"."status" in ('queued','sending','sent','failed','cancelled')),
	CONSTRAINT "notification_delivery_attempts_check" CHECK ("notification_deliveries"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "notification_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text DEFAULT 'expo' NOT NULL,
	"platform" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_ciphertext" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "notification_endpoint_provider_check" CHECK ("notification_endpoints"."provider" in ('expo')),
	CONSTRAINT "notification_endpoint_platform_check" CHECK ("notification_endpoints"."platform" in ('android','ios'))
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"edition_available" boolean DEFAULT true NOT NULL,
	"previous_solution" boolean DEFAULT true NOT NULL,
	"time_zone" text DEFAULT 'Europe/Madrid' NOT NULL,
	"quiet_start" text DEFAULT '22:00' NOT NULL,
	"quiet_end" text DEFAULT '08:00' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "notification_quiet_start_check" CHECK ("notification_preferences"."quiet_start" ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "notification_quiet_end_check" CHECK ("notification_preferences"."quiet_end" ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_endpoint_id_notification_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."notification_endpoints"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_endpoints" ADD CONSTRAINT "notification_endpoints_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_dedupe_uidx" ON "notification_deliveries" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notification_deliveries_due_idx" ON "notification_deliveries" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_user_scheduled_idx" ON "notification_deliveries" USING btree ("user_id","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_endpoints_token_hash_uidx" ON "notification_endpoints" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "notification_endpoints_user_active_idx" ON "notification_endpoints" USING btree ("user_id","active");