import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { nanoid } from 'nanoid'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { title, scheduled_at, description, assigned_host_id } = await request.json()
    
    // Get host record
    const { data: host, error: hostError } = await supabase
      .from('hosts')
      .select('id')
      .eq('user_id', user.id)
      .single()
    
    if (hostError || !host) {
      return NextResponse.json({ error: 'Not a registered host' }, { status: 403 })
    }

    // Generate unique room code
    const roomCode = nanoid(8).toUpperCase()
    
    // Create stream
    const { data: stream, error: streamError } = await supabase
      .from('streams')
      .insert({
        host_id: host.id,
        assigned_host_id: assigned_host_id || host.id,
        room_code: roomCode,
        title: title || 'Live Stream',
        description: description || null,
        status: scheduled_at ? 'scheduled' : 'waiting',
        scheduled_at: scheduled_at || null,
      })
      .select()
      .single()
    
    if (streamError) {
      return NextResponse.json({ error: streamError.message }, { status: 500 })
    }

    return NextResponse.json({ stream, roomCode })
  } catch (error) {
    console.error('Error creating stream:', error)
    return NextResponse.json({ error: 'Failed to create stream' }, { status: 500 })
  }
}

export async function GET() {
  try {
    const supabase = await createClient()
    
    const { data: streams, error } = await supabase
      .from('streams')
      .select(`
        *,
        hosts (
          display_name,
          email
        )
      `)
      .eq('status', 'live')
      .order('started_at', { ascending: false })
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ streams })
  } catch (error) {
    console.error('Error fetching streams:', error)
    return NextResponse.json({ error: 'Failed to fetch streams' }, { status: 500 })
  }
}
