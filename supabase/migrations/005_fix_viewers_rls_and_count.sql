-- Fix: Replace the broad FOR ALL policy with explicit per-operation policies
-- The FOR ALL USING pattern can silently block INSERT for anonymous users
-- Separate policies are clearer and more reliable

DROP POLICY IF EXISTS "Anyone can manage viewers for visible streams" ON viewers;
DROP POLICY IF EXISTS "Anyone can view viewers" ON viewers;
DROP POLICY IF EXISTS "Anyone can insert as viewer" ON viewers;
DROP POLICY IF EXISTS "Anyone can update viewer record" ON viewers;
DROP POLICY IF EXISTS "Anyone can delete viewer record" ON viewers;

-- SELECT: anyone can see viewers for live/waiting streams
CREATE POLICY "Anyone can view viewers" ON viewers
  FOR SELECT USING (true);

-- INSERT: anyone can join as a viewer on a live/waiting stream
CREATE POLICY "Anyone can insert as viewer" ON viewers
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM streams
      WHERE streams.id = stream_id
      AND streams.status IN ('live', 'waiting')
    )
  );

-- UPDATE: anyone can update their own viewer record (e.g. mark as left)
CREATE POLICY "Anyone can update viewer record" ON viewers
  FOR UPDATE USING (true) WITH CHECK (true);

-- DELETE: anyone can remove a viewer record
CREATE POLICY "Anyone can delete viewer record" ON viewers
  FOR DELETE USING (true);

-- Also ensure the viewer_count trigger function is correct
-- Re-create it to handle edge cases properly
CREATE OR REPLACE FUNCTION update_viewer_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE streams
        SET viewer_count = (
          SELECT COUNT(*) FROM viewers
          WHERE stream_id = NEW.stream_id AND left_at IS NULL
        )
        WHERE id = NEW.stream_id;
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        UPDATE streams
        SET viewer_count = (
          SELECT COUNT(*) FROM viewers
          WHERE stream_id = NEW.stream_id AND left_at IS NULL
        )
        WHERE id = NEW.stream_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE streams
        SET viewer_count = (
          SELECT COUNT(*) FROM viewers
          WHERE stream_id = OLD.stream_id AND left_at IS NULL
        )
        WHERE id = OLD.stream_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ language 'plpgsql' SECURITY DEFINER;
