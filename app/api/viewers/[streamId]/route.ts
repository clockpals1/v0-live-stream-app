import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ streamId: string }> }
) {
  try {
    const { streamId } = await params
    const supabase = await createClient()
    
    const { count, error } = await supabase
      .from('viewers')
      .select('*', { count: 'exact', head: true })
      .eq('stream_id', streamId)
      .is('left_at', null)
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ count: count || 0 })
  } catch (error) {
    console.error('Error fetching viewer count:', error)
    return NextResponse.json({ error: 'Failed to fetch viewer count' }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ streamId: string }> }
) {
  try {
    const { streamId } = await params
    const supabase = await createClient()
    const { viewer_name } = await request.json()
    
    const { data: viewer, error } = await supabase
      .from('viewers')
      .insert({
        stream_id: streamId,
        viewer_name: viewer_name || 'Anonymous'
      })
      .select()
      .single()
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ viewer })
  } catch (error) {
    console.error('Error adding viewer:', error)
    return NextResponse.json({ error: 'Failed to add viewer' }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ streamId: string }> }
) {
  try {
    const { streamId } = await params
    const supabase = await createClient()
    const { viewer_id } = await request.json()
    
    const { error } = await supabase
      .from('viewers')
      .update({ left_at: new Date().toISOString() })
      .eq('id', viewer_id)
      .eq('stream_id', streamId)
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating viewer:', error)
    return NextResponse.json({ error: 'Failed to update viewer' }, { status: 500 })
  }
}
