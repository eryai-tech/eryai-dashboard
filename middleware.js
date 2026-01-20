import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'

export async function middleware(request) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session
  const { data: { user } } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname

  // Public routes - no auth required
  const publicRoutes = ['/login', '/auth/callback']
  if (publicRoutes.some(route => path.startsWith(route))) {
    // If logged in and trying to access login, redirect to dashboard
    if (user && path === '/login') {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
    return supabaseResponse
  }

  // MFA routes - requires aal1 but not aal2
  const mfaRoutes = ['/mfa/setup', '/mfa/verify']
  if (mfaRoutes.some(route => path.startsWith(route))) {
    if (!user) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    return supabaseResponse
  }

  // Protected routes - requires full auth (aal2 if MFA is set up)
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Check MFA status
  const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  
  if (aalData) {
    const { currentLevel, nextLevel } = aalData

    // User has MFA set up but hasn't verified this session
    if (currentLevel === 'aal1' && nextLevel === 'aal2') {
      return NextResponse.redirect(new URL('/mfa/verify', request.url))
    }

    // User doesn't have MFA set up yet - force setup
    if (nextLevel === 'aal1') {
      // Check if user has any factors
      const { data: factors } = await supabase.auth.mfa.listFactors()
      if (!factors?.totp || factors.totp.length === 0) {
        if (!path.startsWith('/mfa/setup')) {
          return NextResponse.redirect(new URL('/mfa/setup', request.url))
        }
      }
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json|icons/.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
