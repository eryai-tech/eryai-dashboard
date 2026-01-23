import { createAdminClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import DashboardClient from './DashboardClient'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

export const dynamic = 'force-dynamic'

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

  // Use admin client to bypass RLS
  const adminClient = createAdminClient()

  // Check if superadmin (from superadmins table)
  const { data: superadminData } = await adminClient
    .from('superadmins')
    .select('id')
    .eq('email', user.email)
    .single()
  
  const isSuperadmin = !!superadminData

  // Get user's memberships and access
  let customerId = null
  let customerName = null
  let customerPlan = 'starter'
  let userRole = 'member'
  let organizationId = null
  let accessibleCustomerIds = []

  if (isSuperadmin) {
    userRole = 'owner' // Superadmin has full access
  } else {
    // Get user's memberships
    const { data: memberships } = await adminClient
      .from('user_memberships')
      .select(`
        role,
        organization_id,
        customer_id,
        organizations(id, name),
        customers(id, name, plan)
      `)
      .eq('user_id', user.id)

    if (memberships && memberships.length > 0) {
      // Check if user has org-level access (customer_id is null)
      const orgMembership = memberships.find(m => m.organization_id && !m.customer_id)
      
      if (orgMembership) {
        // Org-level access - can see all customers in org
        organizationId = orgMembership.organization_id
        userRole = orgMembership.role || 'admin'
        
        // Get all customers in this org
        const { data: orgCustomers } = await adminClient
          .from('customers')
          .select('id, name, plan')
          .eq('organization_id', organizationId)
        
        accessibleCustomerIds = orgCustomers?.map(c => c.id) || []
        
        // Use first customer's plan as default (or highest plan)
        if (orgCustomers && orgCustomers.length > 0) {
          customerPlan = orgCustomers[0].plan || 'starter'
        }
      } else {
        // Customer-level access only
        const customerMembership = memberships.find(m => m.customer_id)
        if (customerMembership) {
          customerId = customerMembership.customer_id
          customerName = customerMembership.customers?.name || null
          customerPlan = customerMembership.customers?.plan || 'starter'
          userRole = customerMembership.role || 'member'
          accessibleCustomerIds = [customerId]
        }
      }
    }
    
    // Also check dashboard_users table (legacy/fallback)
    if (accessibleCustomerIds.length === 0) {
      const { data: dashboardUser } = await adminClient
        .from('dashboard_users')
        .select('customer_id, role, customers(id, name, plan)')
        .eq('user_id', user.id)
        .single()
      
      if (dashboardUser) {
        customerId = dashboardUser.customer_id
        customerName = dashboardUser.customers?.name || null
        customerPlan = dashboardUser.customers?.plan || 'starter'
        userRole = dashboardUser.role || 'member'
        accessibleCustomerIds = [customerId]
      }
    }
  }

  // Fetch sessions - exclude deleted
  let sessionsQuery = adminClient
    .from('chat_sessions')
    .select('*')
    .neq('status', 'deleted')
    .order('updated_at', { ascending: false })
    .limit(100)

  if (isSuperadmin) {
    // Superadmin sees ALL sessions
  } else if (accessibleCustomerIds.length > 0) {
    // User with access - filter by their customers, hide suspicious
    sessionsQuery = sessionsQuery
      .in('customer_id', accessibleCustomerIds)
      .or('suspicious.is.null,suspicious.eq.false')
  } else {
    // No access - return empty
    sessionsQuery = sessionsQuery.eq('customer_id', '00000000-0000-0000-0000-000000000000')
  }

  const { data: sessions } = await sessionsQuery

  // Add is_read default if not present (backwards compatibility)
  const sessionsWithDefaults = (sessions || []).map(s => ({
    ...s,
    is_read: s.is_read ?? true
  }))

  // Get all customers for filter (superadmin or org-level access)
  let customers = []
  if (isSuperadmin) {
    const { data: allCustomers } = await adminClient
      .from('customers')
      .select('id, name, plan')
      .order('name')
    customers = allCustomers || []
  } else if (organizationId) {
    const { data: orgCustomers } = await adminClient
      .from('customers')
      .select('id, name, plan')
      .eq('organization_id', organizationId)
      .order('name')
    customers = orgCustomers || []
  }

  return (
    <DashboardClient
      user={user}
      isSuperadmin={isSuperadmin}
      customerId={customerId}
      customerName={customerName}
      customerPlan={customerPlan}
      userRole={userRole}
      initialSessions={sessionsWithDefaults}
      customers={customers}
    />
  )
}
