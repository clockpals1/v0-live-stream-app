-- Create hosts table for approved streamers
CREATE TABLE IF NOT EXISTS public.hosts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create streams table
CREATE TABLE IF NOT EXISTS public.streams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID NOT NULL REFERENCES public.hosts(id) ON DELETE CASCADE,
  room_code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT 'Live Stream',
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'live', 'ended')),
  viewer_count INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  recording_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create chat messages table
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id UUID NOT NULL REFERENCES public.streams(id) ON DELETE CASCADE,
  sender_name TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create viewers table for tracking
CREATE TABLE IF NOT EXISTS public.viewers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id UUID NOT NULL REFERENCES public.streams(id) ON DELETE CASCADE,
  viewer_name TEXT NOT NULL,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  left_at TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE public.hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.viewers ENABLE ROW LEVEL SECURITY;

-- Hosts policies (only authenticated users can view their own host record)
CREATE POLICY "hosts_select_own" ON public.hosts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "hosts_update_own" ON public.hosts FOR UPDATE USING (auth.uid() = user_id);

-- Streams policies (hosts can manage their streams, anyone can view live streams)
CREATE POLICY "streams_select_all" ON public.streams FOR SELECT USING (true);
CREATE POLICY "streams_insert_host" ON public.streams FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.hosts WHERE hosts.id = host_id AND hosts.user_id = auth.uid())
);
CREATE POLICY "streams_update_host" ON public.streams FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.hosts WHERE hosts.id = host_id AND hosts.user_id = auth.uid())
);
CREATE POLICY "streams_delete_host" ON public.streams FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.hosts WHERE hosts.id = host_id AND hosts.user_id = auth.uid())
);

-- Chat messages policies (anyone can read and insert messages)
CREATE POLICY "chat_select_all" ON public.chat_messages FOR SELECT USING (true);
CREATE POLICY "chat_insert_all" ON public.chat_messages FOR INSERT WITH CHECK (true);

-- Viewers policies (anyone can view and insert)
CREATE POLICY "viewers_select_all" ON public.viewers FOR SELECT USING (true);
CREATE POLICY "viewers_insert_all" ON public.viewers FOR INSERT WITH CHECK (true);
CREATE POLICY "viewers_update_all" ON public.viewers FOR UPDATE USING (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_streams_room_code ON public.streams(room_code);
CREATE INDEX IF NOT EXISTS idx_streams_status ON public.streams(status);
CREATE INDEX IF NOT EXISTS idx_chat_messages_stream_id ON public.chat_messages(stream_id);
CREATE INDEX IF NOT EXISTS idx_viewers_stream_id ON public.viewers(stream_id);
