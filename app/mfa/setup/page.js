'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useRouter } from 'next/navigation'

export default function MFASetupPage() {
  const [qrCode, setQrCode] = useState('')
  const [secret, setSecret] = useState('')
  const [factorId, setFactorId] = useState('')
  const [verifyCode, setVerifyCode] = useState('')
  const [loading, setLoading] = useState(true)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    enrollMFA()
  }, [])

  const enrollMFA = async () => {
    try {
      // Clean up any unverified factors first
      const { data: existingFactors } = await supabase.auth.mfa.listFactors()
      if (existingFactors?.totp) {
        for (const factor of existingFactors.totp) {
          // @ts-ignore - Supabase types incorrectly mark status as only "verified"
          if (factor.status === 'unverified') {
            await supabase.auth.mfa.unenroll({ factorId: factor.id })
          }
        }
      }

      // Enroll new factor
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'EryAI Dashboard'
      })

      if (enrollError) throw enrollError

      setQrCode(data.totp.qr_code)
      setSecret(data.totp.secret)
      setFactorId(data.id)
    } catch (err) {
      setError(err.message || 'Kunde inte skapa MFA')
    } finally {
      setLoading(false)
    }
  }

  const handleVerify = async (e) => {
    e.preventDefault()
    setVerifying(true)
    setError('')

    try {
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId
      })

      if (challengeError) throw challengeError

      const { data: verifyData, error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code: verifyCode
      })

      if (verifyError) throw verifyError

      // Success! Redirect to dashboard
      router.push('/dashboard')
    } catch (err) {
      setError(err.message || 'Felaktig kod, försök igen')
      setVerifyCode('')
    } finally {
      setVerifying(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-eryai-50 to-eryai-100">
        <div className="bg-white p-8 rounded-2xl shadow-xl">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-eryai-600 mx-auto"></div>
          <p className="text-gray-500 mt-4">Förbereder säkerhetsinställningar...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-eryai-50 to-eryai-100 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-eryai-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-eryai-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">Aktivera 2FA</h1>
          <p className="text-gray-500 mt-2">Skanna QR-koden med din authenticator-app</p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* QR Code */}
        <div className="flex justify-center mb-6">
          {qrCode && (
            <img 
              src={qrCode} 
              alt="QR Code för 2FA" 
              className="w-48 h-48 border rounded-lg"
            />
          )}
        </div>

        {/* Manual secret */}
        <div className="mb-6 p-3 bg-gray-50 rounded-lg">
          <p className="text-xs text-gray-500 mb-1">Eller ange manuellt:</p>
          <code className="text-sm font-mono text-gray-700 break-all select-all">{secret}</code>
        </div>

        {/* Verify form */}
        <form onSubmit={handleVerify} className="space-y-4">
          <div>
            <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-1">
              Ange kod från appen
            </label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ''))}
              required
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-eryai-500 focus:border-transparent transition text-center text-2xl tracking-widest font-mono"
              placeholder="000000"
              autoFocus
            />
          </div>

          <button
            type="submit"
            disabled={verifying || verifyCode.length !== 6}
            className="w-full bg-eryai-600 text-white py-3 rounded-lg font-medium hover:bg-eryai-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {verifying ? 'Verifierar...' : 'Aktivera 2FA'}
          </button>
        </form>

        {/* Recommended apps */}
        <div className="mt-6 pt-6 border-t">
          <p className="text-xs text-gray-500 text-center">
            Rekommenderade appar: Google Authenticator, Authy, 1Password
          </p>
        </div>
      </div>
    </div>
  )
}
