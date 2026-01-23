import { createAdminClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import DashboardClient from './DashboardClient'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const cookieStore = await cookies()
  
  // Create user client for auth
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

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    redirect('/login')
  }

  // Check MFA
  const { data: { currentLevel } } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (currentLevel !== 'aal2') {
    redirect('/mfa/verify')
  }

  // Use admin client for data fetching
  const adminClient = createAdminClient()

  // Check if superadmin
  const { data: superadminData } = await adminClient
    .from('superadmins')
    .select('id')
    .eq('user_id', user.id)
    .single()
  
  const isSuperadmin = !!superadminData

  let customers = []
  let initialCustomerId = null
  let customerPlan = 'starter'
  let userRole = 'member'
  let customerLogo = null
  let teamMembers = []

  if (isSuperadmin) {
    // Superadmin sees all customers with logo_url
    const { data } = await adminClient
      .from('customers')
      .select('id, name, slug, plan, logo_url')
      .order('name')
    customers = data || []
    if (customers.length > 0) {
      initialCustomerId = null // Show "Alla kunder" first
      customerPlan = customers[0].plan || 'starter'
      customerLogo = customers[0].logo_url
    }
    userRole = 'superadmin'
  } else {
    // Check user_memberships for org-level access
    const { data: memberships } = await adminClient
      .from('user_memberships')
      .select('id, role, organization_id, customer_id, team_id')
      .eq('user_id', user.id)

    if (memberships && memberships.length > 0) {
      const orgMembership = memberships.find(m => m.organization_id)
      
      if (orgMembership) {
        // User has org access - get all customers in this organization
        const { data: orgCustomers } = await adminClient
          .from('customers')
          .select('id, name, slug, plan, logo_url')
          .eq('organization_id', orgMembership.organization_id)
          .order('name')
        
        customers = orgCustomers || []
        userRole = orgMembership.role || 'member'
        
        // Also get the organization's plan
        const { data: orgData } = await adminClient
          .from('organizations')
          .select('plan')
          .eq('id', orgMembership.organization_id)
          .single()
        
        if (orgData?.plan) {
          customerPlan = orgData.plan
        }
      } else if (memberships.some(m => m.customer_id)) {
        // Direct customer access
        const customerIds = memberships.filter(m => m.customer_id).map(m => m.customer_id)
        
        const { data: customerData } = await adminClient
          .from('customers')
          .select('id, name, slug, plan, logo_url')
          .in('id', customerIds)
          .order('name')
        
        customers = customerData || []
        userRole = memberships[0]?.role || 'member'
      }

      if (customers.length > 0) {
        initialCustomerId = null // Show "Alla kunder" first
        customerPlan = customers[0].plan || customerPlan
        customerLogo = customers[0].logo_url
      }
    } else {
      // Fallback to dashboard_users
      const { data: dashboardUser } = await adminClient
        .from('dashboard_users')
        .select('customer_id, customers(id, name, slug, plan, logo_url)')
        .eq('user_id', user.id)
        .single()

      if (dashboardUser?.customers) {
        customers = [{
          id: dashboardUser.customers.id,
          name: dashboardUser.customers.name,
          slug: dashboardUser.customers.slug,
          plan: dashboardUser.customers.plan,
          logo_url: dashboardUser.customers.logo_url
        }]
        initialCustomerId = dashboardUser.customer_id
        customerPlan = dashboardUser.customers.plan || 'starter'
        customerLogo = dashboardUser.customers.logo_url
      }
    }
  }

  // Create a map of customer_id -> customer for easy lookup
  const customerMap = {}
  customers.forEach(c => {
    customerMap[c.id] = { name: c.name, slug: c.slug }
  })

  // Fetch sessions - using ACTUAL column names from chat_sessions table
  let sessions = []
  
  if (isSuperadmin || customers.length > 0) {
    const customerIds = customers.map(c => c.id)
    
    let query = adminClient
      .from('chat_sessions')
      .select(`
        id,
        customer_id,
        visitor_id,
        session_start,
        session_end,
        message_count,
        metadata,
        created_at,
        updated_at,
        status,
        needs_human,
        is_read,
        deleted_at,
        assigned_to,
        assigned_type,
        assigned_user_id,
        assigned_team_id
      `)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(100)
    
    // Only filter by customer_id if not superadmin with all customers
    if (!isSuperadmin) {
      query = query.in('customer_id', customerIds)
    }
    
    const { data, error } = await query
    
    if (error) {
      console.error('Sessions query error:', error)
    }
    
    sessions = data || []
  }

  // Add customer info and extract guest info from metadata
  const sessionsWithCount = sessions.map(s => {
    // Extract guest info from metadata if available
    const metadata = s.metadata || {}
    const guestName = metadata.guest_name || metadata.name || metadata.guestName || null
    const guestEmail = metadata.guest_email || metadata.email || metadata.guestEmail || null
    
    return {
      ...s,
      guest_name: guestName,
      guest_email: guestEmail,
      is_read: s.is_read ?? true,
      customer: customerMap[s.customer_id] || { name: 'Okänd', slug: '' }
    }
  })

  // Fetch team members for assignment
  if (customers.length > 0) {
    const customerIds = customers.map(c => c.id)
    
    const { data: members } = await adminClient
      .from('user_memberships')
      .select('user_id, role')
      .or(customerIds.map(id => `customer_id.eq.${id}`).join(','))

    const { data: dashboardMembers } = await adminClient
      .from('dashboard_users')
      .select('user_id')
      .in('customer_id', customerIds)

    const allMemberIds = new Set([
      ...(members || []).map(m => m.user_id),
      ...(dashboardMembers || []).map(m => m.user_id)
    ])

    if (allMemberIds.size > 0) {
      const { data: userProfiles } = await adminClient
        .from('user_profiles')
        .select('user_id, name, email')
        .in('user_id', Array.from(allMemberIds))

      if (userProfiles && userProfiles.length > 0) {
        teamMembers = userProfiles.map(p => ({
          id: p.user_id,
          name: p.name,
          email: p.email,
          role: members?.find(m => m.user_id === p.user_id)?.role || 'member'
        }))
      }
    }
  }

  return (
    <DashboardClient
      user={user}
      isSuperadmin={isSuperadmin}
      customers={customers}
      initialSessions={sessionsWithCount}
      initialCustomerId={initialCustomerId}
      teamMembers={teamMembers}
      customerPlan={customerPlan}
      userRole={userRole}
      customerLogo={customerLogo}
    />
  )
}
