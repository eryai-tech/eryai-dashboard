import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import webpush from 'web-push';

// Lazy initialization - skapas först vid första anrop
let supabase = null;
let vapidConfigured = false;

function getSupabase() {
  if (!supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) {
      throw new Error('Supabase environment variables not configured');
    }
    supabase = createClient(url, key);
  }
  return supabase;
}

function configureVapid() {
  if (!vapidConfigured) {
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) {
      throw new Error('VAPID environment variables not configured');
    }
    webpush.setVapidDetails(
      'mailto:eric@eryai.tech',
      publicKey,
      privateKey
    );
    vapidConfigured = true;
  }
}

export async function POST(request) {
  try {
    // Validate internal API key
    const apiKey = request.headers.get('X-Internal-API-Key');
    const validKey = process.env.INTERNAL_API_KEY;

    if (!apiKey || apiKey !== validKey) {
      console.error('Push API: Invalid or missing API key');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Initialize clients lazily
    const db = getSupabase();
    configureVapid();

    const { customerId, userId, title, body, data } = await request.json();

    if (!title || !body) {
      return NextResponse.json(
        { error: 'title and body required' },
        { status: 400 }
      );
    }

    // Hämta subscriptions - antingen för specifik user eller alla för en customer
    let query = db.from('push_subscriptions').select('*');
    
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
      console.log('Push API: No subscriptions found for', customerId || userId);
      return NextResponse.json({ 
        success: true, 
        sent: 0,
        total: 0,
        message: 'No subscriptions found' 
      });
    }

    console.log(`Push API: Found ${subscriptions.length} subscriptions`);

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
          console.error('Push send error:', err.statusCode, err.message);
          // Ta bort ogiltiga subscriptions
          if (err.statusCode === 410 || err.statusCode === 404) {
            await db
              .from('push_subscriptions')
              .delete()
              .eq('endpoint', sub.endpoint);
            console.log('Removed invalid subscription:', sub.endpoint);
          }
          return { success: false, endpoint: sub.endpoint, error: err.message };
        }
      })
    );

    const sent = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    console.log(`Push API: Sent ${sent}/${subscriptions.length}`);

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
