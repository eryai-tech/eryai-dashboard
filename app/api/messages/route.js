import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const sessionId = searchParams.get('sessionId') || searchParams.get('session_id')

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }

  // Use admin client to bypass RLS
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  )

  // Fetch messages
  const { data: messages, error } = await supabase
    .from('chat_messages')
    .select('id, session_id, role, content, timestamp, sender_type')
    .eq('session_id', sessionId)
    .order('timestamp', { ascending: true })

  if (error) {
    console.error('Messages error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Transform to match expected format in DashboardClient
  const formattedMessages = (messages || []).map(msg => ({
    id: msg.id,
    session_id: msg.session_id,
    role: msg.role,
    content: msg.content,
    created_at: msg.timestamp,
    sender_type: msg.sender_type
  }))

  return NextResponse.json({ messages: formattedMessages })
}
