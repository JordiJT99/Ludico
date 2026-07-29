CREATE TABLE "analytics_event_quarantine" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"event_count" integer NOT NULL,
	"reason" text NOT NULL,
	"structural_fingerprint" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_quarantine_subject_check" CHECK ("analytics_event_quarantine"."subject_type" in ('guest','user')),
	CONSTRAINT "analytics_quarantine_event_count_check" CHECK ("analytics_event_quarantine"."event_count" between 1 and 100),
	CONSTRAINT "analytics_quarantine_reason_check" CHECK ("analytics_event_quarantine"."reason" in ('INVALID_ANALYTICS_EVENT'))
);
--> statement-breakpoint
CREATE INDEX "analytics_quarantine_received_idx" ON "analytics_event_quarantine" USING btree ("received_at");