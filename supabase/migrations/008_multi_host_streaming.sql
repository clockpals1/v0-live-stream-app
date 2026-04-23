-- Multi-Host Streaming
-- Adds co-host participation table and active camera tracking

-- Co-host slots for a stream
CREATE TABLE IF NOT EXISTS stream_participants (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  stream_id     UUID NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  host_id       UUID NOT NULL REFERENCES hosts(id)   ON DELETE CASCADE,
  slot_label    TEXT NOT NULL DEFAULT 'Camera',
  status        TEXT NOT NULL DEFAULT 'invited'
                CHECK (status IN ('invited', 'ready', 'live', 'offline')),
  joined_at     TIMESTAMP WITH TIME ZONE,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(stream_id, host_id)
);

-- Track which co-host viewers are currently watching (null = main host)
ALTER TABLE streams
  ADD COLUMN IF NOT EXISTS active_participant_id UUID
  REFERENCES stream_participants(id) ON DELETE SET NULL;

-- Enable RLS
ALTER TABLE stream_participants ENABLE ROW LEVEL SECURITY;

-- Stream owner can fully manage participants
DROP POLICY IF EXISTS "Stream owner can manage participants" ON stream_participants;
CREATE POLICY "Stream owner can manage participants" ON stream_participants
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM streams s
      JOIN hosts h ON h.id = s.host_id
      WHERE s.id = stream_participants.stream_id
        AND h.user_id = auth.uid()
    )
  );

-- Anyone can read participants (viewers need it to resolve signaling channels)
DROP POLICY IF EXISTS "Anyone can view participants" ON stream_participants;
CREATE POLICY "Anyone can view participants" ON stream_participants
  FOR SELECT USING (true);

-- Co-hosts can update their own status row
DROP POLICY IF EXISTS "Co-host can update own status" ON stream_participants;
CREATE POLICY "Co-host can update own status" ON stream_participants
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM hosts h
      WHERE h.id = stream_participants.host_id
        AND h.user_id = auth.uid()
    )
  );
