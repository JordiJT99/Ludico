CREATE TABLE "analytics_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"event_name" text NOT NULL,
	"event_version" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"properties" jsonb NOT NULL,
	"consent_policy_version" text NOT NULL,
	CONSTRAINT "analytics_subject_type_check" CHECK ("analytics_events"."subject_type" in ('guest','user')),
	CONSTRAINT "analytics_event_version_check" CHECK ("analytics_events"."event_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guest_session_id" uuid,
	"user_id" uuid,
	"policy_version" text NOT NULL,
	"analytics" boolean NOT NULL,
	"ads" boolean NOT NULL,
	"source" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consents_subject_xor_check" CHECK (("consent_records"."guest_session_id" is not null) <> ("consent_records"."user_id" is not null)),
	CONSTRAINT "consents_source_check" CHECK ("consent_records"."source" in ('web','android','ios'))
);
--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_name_received_idx" ON "analytics_events" USING btree ("event_name","received_at");--> statement-breakpoint
CREATE INDEX "consents_guest_recorded_idx" ON "consent_records" USING btree ("guest_session_id","recorded_at");--> statement-breakpoint
CREATE INDEX "consents_user_recorded_idx" ON "consent_records" USING btree ("user_id","recorded_at");