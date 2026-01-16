import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function POST(request) {
  try {
    const { sessionId, message } = await request.json()

    if (!sessionId || !message) {
      return NextResponse.json(
        { error: 'sessionId och message krävs' },
        { status: 400 }
      )
    }

    // Skapa Supabase-klient med användarens session
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
        },
      }
    )

    // Verifiera att användaren är inloggad
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Ej inloggad' }, { status: 401 })
    }

    // Använd admin client för att bypassa RLS
    const { createClient } = require('@supabase/supabase-js')
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    // Hämta session för att få gästinfo
    const { data: session, error: sessionError } = await adminClient
      .from('chat_sessions')
      .select('*')
      .eq('id', sessionId)
      .single()

    if (sessionError || !session) {
      return NextResponse.json({ error: 'Session hittades inte' }, { status: 404 })
    }

    // Spara personalens meddelande
    const { data: newMessage, error: messageError } = await adminClient
      .from('chat_messages')
      .insert({
        session_id: sessionId,
        role: 'assistant',
        content: message,
        sender_type: 'human'
      })
      .select()
      .single()

    if (messageError) {
      console.error('Failed to save message:', messageError)
      return NextResponse.json({ error: 'Kunde inte spara meddelande' }, { status: 500 })
    }

    // Uppdatera session
    await adminClient
      .from('chat_sessions')
      .update({ 
        updated_at: new Date().toISOString(),
        needs_human: false 
      })
      .eq('id', sessionId)

    // Uppdatera notification till handled om den finns
    await adminClient
      .from('notifications')
      .update({ status: 'handled' })
      .eq('session_id', sessionId)

    // Skicka email till gästen om vi har deras email
    const guestEmail = session.metadata?.guest_email
    if (guestEmail) {
      await sendGuestReplyEmail(guestEmail, {
        guestName: session.metadata?.guest_name || 'Gäst',
        message: message,
        sessionId: sessionId
      })
    }

    return NextResponse.json({ 
      success: true, 
      message: newMessage,
      emailSent: !!guestEmail
    })

  } catch (error) {
    console.error('Reply API error:', error)
    return NextResponse.json({ error: 'Serverfel' }, { status: 500 })
  }
}

// Skicka email till gästen när personal svarar
async function sendGuestReplyEmail(guestEmail, data) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY
  if (!RESEND_API_KEY) {
    console.log('RESEND_API_KEY not set, skipping guest reply email')
    return
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Bella Italia <sofia@eryai.tech>',
        to: guestEmail,
        reply_to: 'info@bellaitalia.se',
        subject: '💬 Svar från Bella Italia',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: 'Georgia', serif; line-height: 1.8; color: #2d3e2f; margin: 0; padding: 0; background: #faf8f5; }
              .container { max-width: 500px; margin: 0 auto; padding: 20px; }
              .header { text-align: center; padding: 30px 20px; }
              .header h1 { color: #2d3e2f; margin: 0; font-size: 28px; }
              .content { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
              .message-box { background: #f0fdf4; border-left: 4px solid #2d3e2f; padding: 20px; margin: 20px 0; }
              .message { font-size: 16px; }
              .footer { text-align: center; padding: 20px; color: #666; font-size: 14px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>🍝 Bella Italia</h1>
              </div>
              <div class="content">
                <p class="message">Hej ${data.guestName}!</p>
                <p class="message">Vi har svarat på ditt meddelande:</p>
                
                <div class="message-box">
                  <p style="margin: 0; white-space: pre-wrap;">${data.message}</p>
                </div>

                <p class="message">Har du fler frågor? Svara gärna på detta mail eller ring oss på <strong>08-555 1234</strong>.</p>
                
                <p class="message">Varma hälsningar,<br><em>Teamet på Bella Italia</em></p>
              </div>
              <div class="footer">
                Bella Italia · Strandvägen 42, Stockholm · 08-555 1234<br>
                <small>Detta mail skickades via EryAI.tech</small>
              </div>
            </div>
          </body>
          </html>
        `
      })
    })

    const result = await response.json()
    if (response.ok) {
      console.log('Guest reply email sent:', result.id)
    } else {
      console.error('Resend error:', result)
    }
  } catch (error) {
    console.error('Failed to send guest reply email:', error)
  }
}
