'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useParams, useRouter } from 'next/navigation';

export default function ChatSessionPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.sessionId;
  
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [notification, setNotification] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Reply form state
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [replySuccess, setReplySuccess] = useState(false);
  
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  useEffect(() => {
    async function loadData() {
      try {
        // Hämta session
        const { data: sessionData, error: sessionError } = await supabase
          .from('chat_sessions')
          .select('*')
          .eq('id', sessionId)
          .single();

        if (sessionError) throw sessionError;
        setSession(sessionData);

        // Hämta meddelanden
        const { data: messagesData, error: messagesError } = await supabase
          .from('chat_messages')
          .select('*')
          .eq('session_id', sessionId)
          .order('timestamp', { ascending: true });

        if (messagesError) throw messagesError;
        setMessages(messagesData || []);

        // Hämta notification om den finns
        const { data: notifData } = await supabase
          .from('notifications')
          .select('*')
          .eq('session_id', sessionId)
          .single();

        if (notifData) {
          setNotification(notifData);
          
          // Markera som läst
          if (notifData.status === 'unread') {
            await supabase
              .from('notifications')
              .update({ status: 'read' })
              .eq('id', notifData.id);
          }
        }

      } catch (err) {
        console.error('Error loading chat:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    if (sessionId) {
      loadData();
    }
  }, [sessionId, supabase]);

  const handleMarkAsHandled = async () => {
    if (!notification) return;
    
    await supabase
      .from('notifications')
      .update({ status: 'handled' })
      .eq('id', notification.id);
    
    await supabase
      .from('chat_sessions')
      .update({ needs_human: false })
      .eq('id', sessionId);
    
    setNotification({ ...notification, status: 'handled' });
  };

  const handleSendReply = async () => {
    if (!replyText.trim() || sending) return;
    
    setSending(true);
    setReplySuccess(false);
    
    try {
      const response = await fetch('/api/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId,
          message: replyText.trim()
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Kunde inte skicka svar');
      }
      
      // Lägg till det nya meddelandet i listan
      setMessages(prev => [...prev, data.message]);
      setReplyText('');
      setReplySuccess(true);
      
      // Uppdatera notification status
      if (notification) {
        setNotification({ ...notification, status: 'handled' });
      }
      
      // Ta bort success-meddelandet efter 3 sekunder
      setTimeout(() => setReplySuccess(false), 3000);
      
    } catch (err) {
      console.error('Error sending reply:', err);
      alert('Fel: ' + err.message);
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Laddar konversation...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-red-500">Fel: {error}</div>
      </div>
    );
  }

  const guestName = session?.metadata?.guest_name || notification?.guest_name || 'Okänd gäst';
  const guestContact = session?.metadata?.guest_email || session?.metadata?.guest_phone || 
                       notification?.guest_email || notification?.guest_phone || 'Ej angiven';
  const hasGuestEmail = !!(session?.metadata?.guest_email || notification?.guest_email);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <button 
              onClick={() => router.push('/dashboard')}
              className="text-sm text-gray-500 hover:text-gray-700 mb-1"
            >
              ← Tillbaka till dashboard
            </button>
            <h1 className="text-xl font-semibold text-gray-900">
              Konversation med {guestName}
            </h1>
            <p className="text-sm text-gray-500">{guestContact}</p>
          </div>
          
          {notification && notification.status !== 'handled' && (
            <button
              onClick={handleMarkAsHandled}
              className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition"
            >
              ✓ Markera som hanterad
            </button>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6">
        {/* Notification banner */}
        {notification && (
          <div className={`mb-6 p-4 rounded-lg border ${
            notification.type === 'complaint' 
              ? 'bg-red-50 border-red-200' 
              : notification.type === 'reservation'
              ? 'bg-amber-50 border-amber-200'
              : 'bg-blue-50 border-blue-200'
          }`}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">
                  {notification.type === 'reservation' && '📅 Bokningsförfrågan'}
                  {notification.type === 'complaint' && '🚨 Klagomål'}
                  {notification.type === 'question' && '❓ Fråga'}
                </h3>
                <p className="text-gray-700 mt-1">{notification.summary}</p>
                
                {notification.reservation_details && (
                  <div className="mt-3 text-sm text-gray-600">
                    <p><strong>Datum:</strong> {notification.reservation_details.date}</p>
                    <p><strong>Tid:</strong> {notification.reservation_details.time}</p>
                    <p><strong>Antal:</strong> {notification.reservation_details.party_size} personer</p>
                    {notification.reservation_details.special_requests && (
                      <p><strong>Önskemål:</strong> {notification.reservation_details.special_requests}</p>
                    )}
                  </div>
                )}
              </div>
              
              <span className={`text-xs px-2 py-1 rounded ${
                notification.status === 'handled' 
                  ? 'bg-green-100 text-green-700'
                  : notification.status === 'read'
                  ? 'bg-gray-100 text-gray-700'
                  : 'bg-red-100 text-red-700'
              }`}>
                {notification.status === 'handled' ? 'Hanterad' : 
                 notification.status === 'read' ? 'Läst' : 'Ny'}
              </span>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="p-4 border-b border-gray-200 bg-gray-50">
            <h2 className="font-medium text-gray-900">Chatthistorik</h2>
          </div>
          
          <div className="p-4 space-y-4 max-h-[500px] overflow-y-auto">
            {messages.length === 0 ? (
              <p className="text-gray-500 text-center py-8">Inga meddelanden</p>
            ) : (
              messages.map((msg) => {
                const isUser = msg.role === 'user';
                const isHuman = msg.sender_type === 'human';
                
                return (
                  <div
                    key={msg.id}
                    className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-4 py-2 ${
                        isUser
                          ? 'bg-blue-600 text-white'
                          : isHuman
                          ? 'bg-green-100 text-gray-900 border border-green-300'
                          : 'bg-gray-100 text-gray-900'
                      }`}
                    >
                      {/* Visa vem som skickade */}
                      {!isUser && (
                        <p className={`text-xs font-semibold mb-1 ${
                          isHuman ? 'text-green-700' : 'text-gray-500'
                        }`}>
                          {isHuman ? '👤 Personal' : '🤖 Sofia'}
                        </p>
                      )}
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      <p className={`text-xs mt-1 ${
                        isUser ? 'text-blue-200' : isHuman ? 'text-green-600' : 'text-gray-400'
                      }`}>
                        {new Date(msg.timestamp).toLocaleTimeString('sv-SE', {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          
          {/* Reply form */}
          <div className="p-4 border-t border-gray-200 bg-gray-50">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <span>💬 Svara som personal</span>
                {hasGuestEmail && (
                  <span className="text-green-600">• Gästen får email-notis</span>
                )}
                {!hasGuestEmail && (
                  <span className="text-amber-600">• Ingen email (gästen måste kolla chatten)</span>
                )}
              </div>
              
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Skriv ditt svar här..."
                rows={3}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 resize-none"
                disabled={sending}
              />
              
              <div className="flex items-center justify-between">
                {replySuccess && (
                  <span className="text-green-600 text-sm">✓ Svar skickat!</span>
                )}
                {!replySuccess && <span />}
                
                <button
                  onClick={handleSendReply}
                  disabled={!replyText.trim() || sending}
                  className={`px-6 py-2 rounded-lg font-medium transition ${
                    !replyText.trim() || sending
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-green-600 text-white hover:bg-green-700'
                  }`}
                >
                  {sending ? 'Skickar...' : 'Skicka svar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
