import { createAdminClient } from '@/lib/supabase-server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

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
  if (await isSuperadmin(adminClient, email)) {
    return true
  }

  const { data: membership } = await adminClient
    .from('dashboard_users')
    .select('role')
    .eq('user_id', userId)
    .eq('customer_id', customerId)
    .single()

  return membership?.role === 'admin' || membership?.role === 'owner'
}

// Helper: Check if user has any access to customer
async function hasAccess(adminClient, userId, email, customerId) {
  if (await isSuperadmin(adminClient, email)) {
    return true
  }

  const { data: membership } = await adminClient
    .from('dashboard_users')
    .select('role')
    .eq('user_id', userId)
    .eq('customer_id', customerId)
    .single()

  return !!membership
}

// GET - Fetch teams for a customer
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

    // Verify user has access to this customer
    const userHasAccess = await hasAccess(adminClient, user.id, user.email, customerId)
    if (!userHasAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Fetch teams
    const { data: teams, error } = await adminClient
      .from('teams')
      .select('id, name, description, is_default, created_at')
      .eq('customer_id', customerId)
      .order('name')

    if (error) throw error

    // Get member counts
    const teamIds = teams?.map(t => t.id) || []
    
    // Create result array with member_count
    const teamsWithCount = (teams || []).map(t => ({
      ...t,
      member_count: 0
    }))

    if (teamIds.length > 0) {
      const { data: members } = await adminClient
        .from('dashboard_users')
        .select('team_id')
        .in('team_id', teamIds)

      const countMap = new Map()
      members?.forEach(m => {
        countMap.set(m.team_id, (countMap.get(m.team_id) || 0) + 1)
      })

      teamsWithCount.forEach(t => {
        t.member_count = countMap.get(t.id) || 0
      })
    }

    return NextResponse.json({ teams: teamsWithCount })

  } catch (error) {
    console.error('Fetch teams error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST - Create new team
export async function POST(request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { customer_id, name, description } = body

    if (!customer_id || !name) {
      return NextResponse.json({ error: 'customer_id and name required' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    // Verify admin access
    const userHasAccess = await hasAdminAccess(adminClient, user.id, user.email, customer_id)
    if (!userHasAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Create team
    const { data: team, error } = await adminClient
      .from('teams')
      .insert({
        customer_id,
        name: name.trim(),
        description: description?.trim() || null
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Ett team med detta namn finns redan' }, { status: 400 })
      }
      throw error
    }

    return NextResponse.json({ success: true, team })

  } catch (error) {
    console.error('Create team error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// PATCH - Update team
export async function PATCH(request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { customer_id, team_id, name, description, is_default } = body

    if (!customer_id || !team_id) {
      return NextResponse.json({ error: 'customer_id and team_id required' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    // Verify admin access
    const userHasAccess = await hasAdminAccess(adminClient, user.id, user.email, customer_id)
    if (!userHasAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const updateData = {}
    if (name) updateData.name = name.trim()
    if (description !== undefined) updateData.description = description?.trim() || null
    if (is_default !== undefined) updateData.is_default = is_default

    // If setting as default, unset other defaults first
    if (is_default === true) {
      await adminClient
        .from('teams')
        .update({ is_default: false })
        .eq('customer_id', customer_id)
    }

    const { error } = await adminClient
      .from('teams')
      .update(updateData)
      .eq('id', team_id)
      .eq('customer_id', customer_id)

    if (error) throw error

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Update team error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE - Remove team
export async function DELETE(request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { customer_id, team_id } = body

    if (!customer_id || !team_id) {
      return NextResponse.json({ error: 'customer_id and team_id required' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    // Verify admin access
    const userHasAccess = await hasAdminAccess(adminClient, user.id, user.email, customer_id)
    if (!userHasAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Check if team has members
    const { count } = await adminClient
      .from('dashboard_users')
      .select('*', { count: 'exact', head: true })
      .eq('team_id', team_id)

    if (count && count > 0) {
      return NextResponse.json({ 
        error: `Teamet har ${count} medlemmar. Flytta dem först innan du raderar.` 
      }, { status: 400 })
    }

    const { error } = await adminClient
      .from('teams')
      .delete()
      .eq('id', team_id)
      .eq('customer_id', customer_id)

    if (error) throw error

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Delete team error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
