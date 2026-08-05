CREATE TABLE "publication_settings" (
	"market" text PRIMARY KEY NOT NULL,
	"opens_at_local_time" text DEFAULT '00:00' NOT NULL,
	"closes_at_local_time" text DEFAULT '00:00' NOT NULL,
	"content_plan_local_time" text DEFAULT '02:00' NOT NULL,
	"reserve_days" integer DEFAULT 14 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "publication_settings_market_check" CHECK ("publication_settings"."market" = 'ES'),
	CONSTRAINT "publication_settings_reserve_check" CHECK ("publication_settings"."reserve_days" between 7 and 21)
);
