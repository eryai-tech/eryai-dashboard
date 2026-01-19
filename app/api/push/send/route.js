import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import webpush from 'web-push';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

webpush.setVapidDetails(
  'mailto:eric@eryai.tech',
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export async function POST(request) {
  try {
    const { customerId, userId, title, body, data } = await request.json();

    if (!title || !body) {
      return NextResponse.json(
        { error: 'title and body required' },
        { status: 400 }
      );
    }

    // Hämta subscriptions - antingen för specifik user eller alla för en customer
    let query = supabase.from('push_subscriptions').select('*');
    
    if (userId) {
      query = query.eq('user_id', userId);
    } else if (customerId) {
      query = query.eq('customer_id', customerId);
    } else {
      return NextResponse.json(
        { error: 'customerId or userId required' },
        { status: 400 }
      );
    }

    const { data: subscriptions, error } = await query;

    if (error) throw error;

    if (!subscriptions || subscriptions.length === 0) {
      return NextResponse.json({ 
        success: true, 
        sent: 0,
        message: 'No subscriptions found' 
      });
    }

    const payload = JSON.stringify({
      title,
      body,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-96x96.png',
      data: data || {}
    });

    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth
              }
            },
            payload
          );
          return { success: true, endpoint: sub.endpoint };
        } catch (err) {
          // Ta bort ogiltiga subscriptions
          if (err.statusCode === 410 || err.statusCode === 404) {
            await supabase
              .from('push_subscriptions')
              .delete()
              .eq('endpoint', sub.endpoint);
          }
          return { success: false, endpoint: sub.endpoint, error: err.message };
        }
      })
    );

    const sent = results.filter(r => r.status === 'fulfilled' && r.value.success).length;

    return NextResponse.json({ 
      success: true, 
      sent,
      total: subscriptions.length 
    });
  } catch (error) {
    console.error('Send push error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
