import { createAdminClient } from '@/lib/supabase-server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

// Plan limits
const PLAN_LIMITS = {
  starter: 3,
  pro: 10,
  enterprise: 999
}

// Helper: Get current user
async function getCurrentUser() {
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
  return user
}

// Helper: Check if user is superadmin
async function isSuperadmin(adminClient, email) {
  const { data } = await adminClient
    .from('superadmins')
    .select('id')
    .eq('email', email)
    .single()
  return !!data
}

// Helper: Check if user has admin access to customer
async function hasAdminAccess(adminClient, userId, email, customerId) {
  // Superadmin has access to everything
  if (await isSuperadmin(adminClient, email)) {
    return true
  }

  // Check dashboard_users for admin/owner role
  const { data: membership } = await adminClient
    .from('dashboard_users')
    .select('role')
    .eq('user_id', userId)
    .eq('customer_id', customerId)
    .single()

  return membership?.role === 'admin' || membership?.role === 'owner'
}

// GET - Fetch users for a customer
export async function GET(request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const customerId = searchParams.get('customer_id')

    if (!customerId) {
      return NextResponse.json({ error: 'customer_id required' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    // Verify admin access
    const hasAccess = await hasAdminAccess(adminClient, user.id, user.email, customerId)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Fetch users with their team info
    const { data: users, error } = await adminClient
      .from('dashboard_users')
      .select(`
        user_id,
        customer_id,
        role,
        team_id,
        status,
        created_at,
        teams (name)
      `)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: true })

    if (error) throw error

    // Get emails from user_profiles
    const userIds = users?.map(u => u.user_id) || []
    
    let emailMap = new Map()
    if (userIds.length > 0) {
      const { data: profiles } = await adminClient
        .from('user_profiles')
        .select('user_id, email')
        .in('user_id', userIds)

      profiles?.forEach(p => emailMap.set(p.user_id, p.email))
    }

    const enrichedUsers = users?.map(u => ({
      ...u,
      email: emailMap.get(u.user_id) || u.user_id.slice(0, 8) + '...',
      team_name: u.teams?.name || null
    })) || []

    // Also get pending invites
    const { data: invites } = await adminClient
      .from('user_invites')
      .select('id, email, role, team_id, status, created_at')
      .eq('customer_id', customerId)
      .eq('status', 'pending')

    const pendingUsers = invites?.map(i => ({
      user_id: i.id,
      email: i.email,
      role: i.role,
      team_id: i.team_id,
      status: 'pending',
      created_at: i.created_at,
      is_invite: true
    })) || []

    return NextResponse.json({ 
      users: [...enrichedUsers, ...pendingUsers]
    })

  } catch (error) {
    console.error('Fetch users error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST - Invite new user
export async function POST(request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { customer_id, email, role, team_id } = body

    if (!customer_id || !email) {
      return NextResponse.json({ error: 'customer_id and email required' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    // Verify admin access
    const hasAccess = await hasAdminAccess(adminClient, user.id, user.email, customer_id)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Check plan limits
    const { data: customer } = await adminClient
      .from('customers')
      .select('plan')
      .eq('id', customer_id)
      .single()

    const plan = customer?.plan || 'starter'
    const limit = PLAN_LIMITS[plan] || PLAN_LIMITS.starter

    const { count } = await adminClient
      .from('dashboard_users')
      .select('*', { count: 'exact', head: true })
      .eq('customer_id', customer_id)

    if (count >= limit) {
      return NextResponse.json({ 
        error: `Du har nått gränsen på ${limit} användare för din plan. Uppgradera för att lägga till fler.` 
      }, { status: 400 })
    }

    // Check if user already exists by email
    const { data: existingProfile } = await adminClient
      .from('user_profiles')
      .select('user_id')
      .eq('email', email.toLowerCase())
      .single()

    if (existingProfile) {
      // User exists - check if already has access
      const { data: existingMembership } = await adminClient
        .from('dashboard_users')
        .select('id')
        .eq('user_id', existingProfile.user_id)
        .eq('customer_id', customer_id)
        .single()

      if (existingMembership) {
        return NextResponse.json({ error: 'Användaren har redan tillgång' }, { status: 400 })
      }

      // Add user directly
      const { error: insertError } = await adminClient
        .from('dashboard_users')
        .insert({
          user_id: existingProfile.user_id,
          customer_id,
          role: role || 'member',
          team_id: team_id || null,
          status: 'active'
        })

      if (insertError) throw insertError

      return NextResponse.json({ success: true, message: 'Användare tillagd' })
    }

    // User doesn't exist - create invite
    const token = crypto.randomUUID()
    
    const { data: invite, error: inviteError } = await adminClient
      .from('user_invites')
      .insert({
        customer_id,
        email: email.toLowerCase(),
        role: role || 'member',
        team_id: team_id || null,
        invited_by: user.id,
        status: 'pending',
        token,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      })
      .select()
      .single()

    if (inviteError) {
      if (inviteError.code === '23505') {
        return NextResponse.json({ error: 'En inbjudan finns redan för denna email' }, { status: 400 })
      }
      throw inviteError
    }

    // TODO: Send invite email via Resend
    // const inviteUrl = `https://dashboard.eryai.tech/invite/${token}`
    // await sendInviteEmail(email, inviteUrl, customerName)

    return NextResponse.json({ 
      success: true, 
      message: 'Inbjudan skapad (email-utskick kommer snart)',
      invite_id: invite.id
    })

  } catch (error) {
    console.error('Invite user error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// PATCH - Update user role
export async function PATCH(request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { customer_id, user_id, role, team_id } = body

    if (!customer_id || !user_id) {
      return NextResponse.json({ error: 'customer_id and user_id required' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    // Verify admin access
    const hasAccess = await hasAdminAccess(adminClient, user.id, user.email, customer_id)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Can't change owner role
    const { data: targetUser } = await adminClient
      .from('dashboard_users')
      .select('role')
      .eq('user_id', user_id)
      .eq('customer_id', customer_id)
      .single()

    if (targetUser?.role === 'owner') {
      return NextResponse.json({ error: 'Kan inte ändra ägarens roll' }, { status: 400 })
    }

    const updateData = {}
    if (role) updateData.role = role
    if (team_id !== undefined) updateData.team_id = team_id || null

    const { error } = await adminClient
      .from('dashboard_users')
      .update(updateData)
      .eq('user_id', user_id)
      .eq('customer_id', customer_id)

    if (error) throw error

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Update user error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE - Remove user
export async function DELETE(request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { customer_id, user_id, is_invite } = body

    if (!customer_id || !user_id) {
      return NextResponse.json({ error: 'customer_id and user_id required' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    // Verify admin access
    const hasAccess = await hasAdminAccess(adminClient, user.id, user.email, customer_id)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // If it's an invite, delete from user_invites
    if (is_invite) {
      const { error } = await adminClient
        .from('user_invites')
        .delete()
        .eq('id', user_id)
        .eq('customer_id', customer_id)

      if (error) throw error
      return NextResponse.json({ success: true })
    }

    // Can't remove owner
    const { data: targetUser } = await adminClient
      .from('dashboard_users')
      .select('role')
      .eq('user_id', user_id)
      .eq('customer_id', customer_id)
      .single()

    if (targetUser?.role === 'owner') {
      return NextResponse.json({ error: 'Kan inte ta bort ägaren' }, { status: 400 })
    }

    // Can't remove yourself
    if (user_id === user.id) {
      return NextResponse.json({ error: 'Kan inte ta bort dig själv' }, { status: 400 })
    }

    const { error } = await adminClient
      .from('dashboard_users')
      .delete()
      .eq('user_id', user_id)
      .eq('customer_id', customer_id)

    if (error) throw error

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Delete user error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
