CREATE TABLE "assistant_requests" (
	"user_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_requests_user_id_request_id_pk" PRIMARY KEY("user_id","request_id")
);
--> statement-breakpoint
ALTER TABLE "task_comments" ADD COLUMN "reply_to_id" uuid;--> statement-breakpoint
ALTER TABLE "assistant_requests" ADD CONSTRAINT "assistant_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_requests" ADD CONSTRAINT "assistant_requests_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
