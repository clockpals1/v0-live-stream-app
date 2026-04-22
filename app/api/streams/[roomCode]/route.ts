import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ roomCode: string }> }
) {
  try {
    const { roomCode } = await params
    const supabase = await createClient()
    
    const { data: stream, error } = await supabase
      .from('streams')
      .select(`
        *,
        hosts (
          display_name,
          email
        )
      `)
      .eq('room_code', roomCode)
      .single()
    
    if (error || !stream) {
      return NextResponse.json({ error: 'Stream not found' }, { status: 404 })
    }

    return NextResponse.json({ stream })
  } catch (error) {
    console.error('Error fetching stream:', error)
    return NextResponse.json({ error: 'Failed to fetch stream' }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ roomCode: string }> }
) {
  try {
    const { roomCode } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { status, viewer_count, recording_url } = body

    // Build update object
    const updateData: Record<string, unknown> = {}
    if (status) {
      updateData.status = status
      if (status === 'live') {
        updateData.started_at = new Date().toISOString()
      } else if (status === 'ended') {
        updateData.ended_at = new Date().toISOString()
      }
    }
    if (typeof viewer_count === 'number') {
      updateData.viewer_count = viewer_count
    }
    if (recording_url) {
      updateData.recording_url = recording_url
    }

    const { data: stream, error } = await supabase
      .from('streams')
      .update(updateData)
      .eq('room_code', roomCode)
      .select()
      .single()
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ stream })
  } catch (error) {
    console.error('Error updating stream:', error)
    return NextResponse.json({ error: 'Failed to update stream' }, { status: 500 })
  }
}
