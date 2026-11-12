ALTER TABLE "task_comments" ADD COLUMN "highlighted" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "task_comments" ADD COLUMN "highlighted_by" uuid;
--> statement-breakpoint
ALTER TABLE "task_comments" ADD COLUMN "highlighted_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "task_comments_highlight_idx" ON "task_comments" ("project_id", "task_id", "created_at", "id") WHERE "highlighted" = true AND "deleted_at" IS NULL;
