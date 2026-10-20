CREATE TABLE "discussion_task_origins" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"source_task_id" uuid,
	"source_revision" text NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iteration_trend_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"iteration_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"day" text NOT NULL,
	"total" integer NOT NULL,
	"done" integer NOT NULL,
	"task_states" jsonb NOT NULL,
	"sampled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"media_type" text NOT NULL,
	"size" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"digest" text NOT NULL,
	"request_id" uuid NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_confirmation_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"requested_by_id" uuid,
	"epoch" integer NOT NULL,
	"revision" integer NOT NULL,
	"body_hash" text NOT NULL,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_confirmations" (
	"round_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "document_confirmations_round_id_user_id_pk" PRIMARY KEY("round_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "account_project_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"views" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"url_ciphertext" text NOT NULL,
	"credentials_ciphertext" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_feed_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"label" text NOT NULL,
	"include_details" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_feed_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "calendar_remote_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"remote_key" text NOT NULL,
	"href" text NOT NULL,
	"uid" text NOT NULL,
	"etag" text,
	"base_hash" text NOT NULL,
	"recurring" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"resource_name" text NOT NULL,
	"resource_key" text NOT NULL,
	"purpose" text NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"reviewed_by_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_join_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_id" uuid
);
--> statement-breakpoint
CREATE TABLE "team_management_settings" (
	"team_id" uuid PRIMARY KEY NOT NULL,
	"archived_at" timestamp with time zone,
	"invite_expires_at" timestamp with time zone,
	"invite_enabled" boolean DEFAULT true NOT NULL,
	"require_approval" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discussion_task_origins" ADD CONSTRAINT "discussion_task_origins_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_task_origins" ADD CONSTRAINT "discussion_task_origins_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_task_origins" ADD CONSTRAINT "discussion_task_origins_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iteration_trend_samples" ADD CONSTRAINT "iteration_trend_samples_iteration_id_iterations_id_fk" FOREIGN KEY ("iteration_id") REFERENCES "public"."iterations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iteration_trend_samples" ADD CONSTRAINT "iteration_trend_samples_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_attachments" ADD CONSTRAINT "project_attachments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_attachments" ADD CONSTRAINT "project_attachments_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_confirmation_rounds" ADD CONSTRAINT "document_confirmation_rounds_document_id_project_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."project_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_confirmation_rounds" ADD CONSTRAINT "document_confirmation_rounds_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_confirmations" ADD CONSTRAINT "document_confirmations_round_id_document_confirmation_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."document_confirmation_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_confirmations" ADD CONSTRAINT "document_confirmations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_project_views" ADD CONSTRAINT "account_project_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_project_views" ADD CONSTRAINT "account_project_views_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_feed_tokens" ADD CONSTRAINT "calendar_feed_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_remote_events" ADD CONSTRAINT "calendar_remote_events_connection_id_calendar_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_remote_events" ADD CONSTRAINT "calendar_remote_events_event_id_personal_schedule_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."personal_schedule_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_reservations" ADD CONSTRAINT "resource_reservations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_reservations" ADD CONSTRAINT "resource_reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_reservations" ADD CONSTRAINT "resource_reservations_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_join_requests" ADD CONSTRAINT "team_join_requests_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_join_requests" ADD CONSTRAINT "team_join_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_join_requests" ADD CONSTRAINT "team_join_requests_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_management_settings" ADD CONSTRAINT "team_management_settings_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discussion_origins_source_idx" ON "discussion_task_origins" USING btree ("project_id","source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "iteration_trend_day_uq" ON "iteration_trend_samples" USING btree ("iteration_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_owner_request_uq" ON "project_attachments" USING btree ("owner_id","request_id");--> statement-breakpoint
CREATE INDEX "attachment_target_idx" ON "project_attachments" USING btree ("project_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "document_confirmation_document_idx" ON "document_confirmation_rounds" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "account_project_views_owner" ON "account_project_views" USING btree ("user_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_remote_events_key" ON "calendar_remote_events" USING btree ("connection_id","remote_key");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_remote_event_mapping" ON "calendar_remote_events" USING btree ("connection_id","event_id");--> statement-breakpoint
CREATE INDEX "resource_reservations_team_idx" ON "resource_reservations" USING btree ("team_id","status","start_time");--> statement-breakpoint
CREATE INDEX "resource_reservations_conflict_idx" ON "resource_reservations" USING btree ("team_id","resource_key","start_time");--> statement-breakpoint
CREATE UNIQUE INDEX "team_join_requests_user_unique" ON "team_join_requests" USING btree ("team_id","user_id");--> statement-breakpoint
CREATE INDEX "team_join_requests_pending_idx" ON "team_join_requests" USING btree ("team_id","status");