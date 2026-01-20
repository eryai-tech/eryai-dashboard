import { createAdminClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import DashboardClient from './DashboardClient'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

export default async function DashboardPage() {
  // Get current user
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
  
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect('/login')
  }

  // Check if superadmin
  const isSuperadmin = user.email === process.env.SUPERADMIN_EMAIL

  // Use admin client to bypass RLS
  const adminClient = createAdminClient()

  // Get customer_id for this user from dashboard_users
  let customerId = null
  let customerName = null

  if (!isSuperadmin) {
    const { data: dashboardUser } = await adminClient
      .from('dashboard_users')
      .select('customer_id, customers(id, name)')
      .eq('user_id', user.id)
      .single()
    
    if (dashboardUser) {
      customerId = dashboardUser.customer_id
      customerName = dashboardUser.customers?.name || null
    }
  }

  // Fetch sessions - filter by customer if not superadmin
  let sessionsQuery = adminClient
    .from('chat_sessions')
    .select('*, customers(name)')
    .order('updated_at', { ascending: false })
    .limit(100)

  if (!isSuperadmin && customerId) {
    sessionsQuery = sessionsQuery.eq('customer_id', customerId)
  }

  const { data: sessions, error } = await sessionsQuery

  console.log('Sessions error:', error)
  console.log('Sessions count:', sessions?.length)

  // Get all customers for filter (superadmin only)
  let customers = []
  if (isSuperadmin) {
    const { data: allCustomers } = await adminClient
      .from('customers')
      .select('id, name')
      .order('name')
    customers = allCustomers || []
  }

  return (
    <DashboardClient
      user={user}
      isSuperadmin={isSuperadmin}
      customerId={customerId}
      customerName={customerName}
      initialSessions={sessions || []}
      customers={customers}
    />
  )
}
