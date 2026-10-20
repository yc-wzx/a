import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({
  schema: ["./src/db/schema.ts", "./src/db/documents-schema.ts", "./src/db/task-enhancements-schema.ts", "./src/db/course-extensions-schema.ts", "./src/db/document-workflow-schema.ts", "./src/db/calendar-integrations-schema.ts", "./src/db/team-management-schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
