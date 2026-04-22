-- Create hosts table
CREATE TABLE IF NOT EXISTS hosts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create streams table
CREATE TABLE IF NOT EXISTS streams (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  host_id UUID REFERENCES hosts(id) ON DELETE CASCADE,
  room_code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT 'Live Stream',
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'live', 'ended')),
  viewer_count INTEGER DEFAULT 0,
  recording_url TEXT,
  started_at TIMESTAMP WITH TIME ZONE,
  ended_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create viewers table
CREATE TABLE IF NOT EXISTS viewers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  stream_id UUID REFERENCES streams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  connected BOOLEAN DEFAULT true,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  left_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create chat_messages table
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  stream_id UUID REFERENCES streams(id) ON DELETE CASCADE,
  sender_name TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_streams_host_id ON streams(host_id);
CREATE INDEX IF NOT EXISTS idx_streams_room_code ON streams(room_code);
CREATE INDEX IF NOT EXISTS idx_streams_status ON streams(status);
CREATE INDEX IF NOT EXISTS idx_viewers_stream_id ON viewers(stream_id);
CREATE INDEX IF NOT EXISTS idx_viewers_connected ON viewers(connected);
CREATE INDEX IF NOT EXISTS idx_chat_messages_stream_id ON chat_messages(stream_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);

-- Insert the host user (sunday@isunday.me)
-- This will be created after the user signs up for the first time
-- For now, we'll create a placeholder that can be updated
INSERT INTO hosts (user_id, email, display_name)
SELECT 
  id,
  email,
  'Sunday Stream'
FROM auth.users 
WHERE email = 'sunday@isunday.me'
ON CONFLICT (user_id) DO NOTHING;

-- Enable Row Level Security (RLS)
ALTER TABLE hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE viewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Host policies - users can only see their own host records
CREATE POLICY "Users can view their own host profile" ON hosts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own host profile" ON hosts
  FOR UPDATE USING (auth.uid() = user_id);

-- Stream policies - hosts can manage their streams, everyone can view active streams
CREATE POLICY "Hosts can view their own streams" ON streams
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM hosts 
      WHERE hosts.id = streams.host_id 
      AND hosts.user_id = auth.uid()
    )
  );

CREATE POLICY "Hosts can create their own streams" ON streams
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM hosts 
      WHERE hosts.id = streams.host_id 
      AND hosts.user_id = auth.uid()
    )
  );

CREATE POLICY "Hosts can update their own streams" ON streams
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM hosts 
      WHERE hosts.id = streams.host_id 
      AND hosts.user_id = auth.uid()
    )
  );

CREATE POLICY "Everyone can view active streams" ON streams
  FOR SELECT USING (status IN ('live', 'waiting'));

-- Viewer policies - anyone can manage viewers for streams they can see
CREATE POLICY "Anyone can manage viewers for visible streams" ON viewers
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM streams 
      WHERE streams.id = viewers.stream_id 
      AND streams.status IN ('live', 'waiting')
    )
  );

-- Chat policies - anyone can manage chat messages for streams they can see
CREATE POLICY "Anyone can manage chat for visible streams" ON chat_messages
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM streams 
      WHERE streams.id = chat_messages.stream_id 
      AND streams.status IN ('live', 'waiting')
    )
  );

-- Functions to automatically update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_hosts_updated_at BEFORE UPDATE ON hosts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_streams_updated_at BEFORE UPDATE ON streams
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to update viewer count when viewers join/leave
CREATE OR REPLACE FUNCTION update_viewer_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE streams 
        SET viewer_count = viewer_count + 1 
        WHERE id = NEW.stream_id;
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.connected = true AND NEW.connected = false THEN
            UPDATE streams 
            SET viewer_count = viewer_count - 1 
            WHERE id = NEW.stream_id;
        ELSIF OLD.connected = false AND NEW.connected = true THEN
            UPDATE streams 
            SET viewer_count = viewer_count + 1 
            WHERE id = NEW.stream_id;
        END IF;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE streams 
        SET viewer_count = GREATEST(viewer_count - 1, 0) 
        WHERE id = OLD.stream_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ language 'plpgsql';

-- Create triggers for viewer count
CREATE TRIGGER update_viewer_count_on_insert AFTER INSERT ON viewers
    FOR EACH ROW EXECUTE FUNCTION update_viewer_count();

CREATE TRIGGER update_viewer_count_on_update AFTER UPDATE ON viewers
    FOR EACH ROW EXECUTE FUNCTION update_viewer_count();

CREATE TRIGGER update_viewer_count_on_delete AFTER DELETE ON viewers
    FOR EACH ROW EXECUTE FUNCTION update_viewer_count();
