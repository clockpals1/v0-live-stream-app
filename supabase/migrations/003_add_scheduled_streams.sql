-- Add scheduled stream columns to streams table
ALTER TABLE streams
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS assigned_host_id UUID REFERENCES hosts(id) ON DELETE SET NULL;

-- Update status constraint to include 'scheduled'
ALTER TABLE streams DROP CONSTRAINT IF EXISTS streams_status_check;
ALTER TABLE streams ADD CONSTRAINT streams_status_check
  CHECK (status IN ('waiting', 'scheduled', 'live', 'ended'));

-- Index for efficient scheduled stream queries
CREATE INDEX IF NOT EXISTS idx_streams_scheduled_at ON streams(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_streams_assigned_host ON streams(assigned_host_id);

-- Allow assigned hosts to view streams they're assigned to
DROP POLICY IF EXISTS "Assigned hosts can view their streams" ON streams;
CREATE POLICY "Assigned hosts can view their streams" ON streams
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.id = streams.assigned_host_id
      AND hosts.user_id = auth.uid()
    )
  );

-- Allow assigned hosts to update streams they're assigned to (start/stop)
DROP POLICY IF EXISTS "Assigned hosts can update their streams" ON streams;
CREATE POLICY "Assigned hosts can update their streams" ON streams
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.id = streams.assigned_host_id
      AND hosts.user_id = auth.uid()
    )
  );

-- Allow everyone to view scheduled streams (so viewers can see upcoming)
DROP POLICY IF EXISTS "Everyone can view scheduled streams" ON streams;
CREATE POLICY "Everyone can view scheduled streams" ON streams
  FOR SELECT USING (status = 'scheduled');
