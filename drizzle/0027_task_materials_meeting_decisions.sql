CREATE TABLE "meeting_decision_confirmations" (
	"version_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"user_id" uuid,
	"user_name" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "meeting_decision_confirmations_version_id_member_id_pk" PRIMARY KEY("version_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "meeting_decision_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"title" text NOT NULL,
	"adopted_option" text NOT NULL,
	"background" text DEFAULT '' NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"reference_id" uuid NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_by_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_material_links" ADD COLUMN "material_purpose" text;--> statement-breakpoint
ALTER TABLE "project_attachments" ADD COLUMN "material_purpose" text;--> statement-breakpoint
ALTER TABLE "project_attachments" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_decision_confirmations" ADD CONSTRAINT "meeting_decision_confirmations_version_id_meeting_decision_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."meeting_decision_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_decision_confirmations" ADD CONSTRAINT "meeting_decision_confirmations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_decision_versions" ADD CONSTRAINT "meeting_decision_versions_decision_id_meeting_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."meeting_decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_decision_versions" ADD CONSTRAINT "meeting_decision_versions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_decisions" ADD CONSTRAINT "meeting_decisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_decisions" ADD CONSTRAINT "meeting_decisions_reference_id_project_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."project_references"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_decisions" ADD CONSTRAINT "meeting_decisions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_decision_version_uq" ON "meeting_decision_versions" USING btree ("decision_id","revision");--> statement-breakpoint
CREATE INDEX "meeting_decisions_reference_idx" ON "meeting_decisions" USING btree ("project_id","reference_id");