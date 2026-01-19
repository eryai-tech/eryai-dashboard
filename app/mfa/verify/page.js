'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useRouter } from 'next/navigation'

export default function MFAVerifyPage() {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [factorId, setFactorId] = useState('')
  const inputRef = useRef(null)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    loadFactors()
  }, [])

  const loadFactors = async () => {
    const { data: factors, error } = await supabase.auth.mfa.listFactors()
    if (error) {
      setError('Kunde inte ladda autentisering')
      return
    }
    
    if (factors?.totp && factors.totp.length > 0) {
      setFactorId(factors.totp[0].id)
    } else {
      router.push('/mfa/setup')
    }
  }

  const handleCodeChange = (e) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6)
    setCode(value)
  }

  const handleVerify = async (e) => {
    if (e) e.preventDefault()
    if (!factorId || code.length !== 6) return
    
    setLoading(true)
    setError('')

    try {
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId
      })

      if (challengeError) throw challengeError

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code
      })

      if (verifyError) throw verifyError

      router.push('/dashboard')
    } catch (err) {
      setError('Felaktig kod, försök igen')
      setCode('')
      inputRef.current?.focus()
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // Check if button should be enabled
  const isValidCode = code.length === 6

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-eryai-50 to-eryai-100 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-eryai-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-eryai-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">Tvåfaktorsverifiering</h1>
          <p className="text-gray-500 mt-2">Ange koden från din authenticator-app</p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Verify form */}
        <div className="space-y-4">
          <div>
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={handleCodeChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && isValidCode) {
                  handleVerify()
                }
              }}
              className="w-full px-4 py-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-eryai-500 focus:border-transparent transition text-center text-3xl tracking-widest font-mono"
              placeholder="000000"
              autoFocus
            />
          </div>

          <button
            type="button"
            onClick={handleVerify}
            disabled={loading || !isValidCode}
            className="w-full bg-eryai-600 text-white py-3 rounded-lg font-medium hover:bg-eryai-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Verifierar...' : 'Verifiera'}
          </button>
        </div>

        {/* Back to login */}
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={handleLogout}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← Tillbaka till inloggning
          </button>
        </div>
      </div>
    </div>
  )
}
