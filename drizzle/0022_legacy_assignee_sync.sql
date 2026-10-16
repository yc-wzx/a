--> statement-breakpoint
CREATE FUNCTION sync_legacy_task_assignee() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    DELETE FROM task_assignees WHERE task_id = NEW.id;
    IF NEW.assignee_id IS NOT NULL THEN
      INSERT INTO task_assignees(task_id,user_id) VALUES(NEW.id,NEW.assignee_id) ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sync_legacy_task_assignee AFTER INSERT OR UPDATE OF assignee_id ON tasks FOR EACH ROW EXECUTE FUNCTION sync_legacy_task_assignee();
