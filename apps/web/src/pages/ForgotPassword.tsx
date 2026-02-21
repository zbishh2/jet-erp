import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

type Step = 'email' | 'code' | 'password'

interface ForgotPasswordResponse {
  message: string
  code?: string // Only in dev mode
}

export function ForgotPassword() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // Step 1: Request reset code
  const requestMutation = useMutation({
    mutationFn: async () => {
      return apiFetch<ForgotPasswordResponse>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
        skipAuth: true,
      })
    },
    onSuccess: (data) => {
      toast.success('If an account exists, a reset code has been sent')
      // In dev mode, show the code
      if (data.code) {
        toast.info(`Dev mode - Code: ${data.code}`, { duration: 10000 })
      }
      setStep('code')
    },
    onError: () => {
      // Still show success to prevent email enumeration
      toast.success('If an account exists, a reset code has been sent')
      setStep('code')
    },
  })

  // Step 2 & 3: Reset password with code
  const resetMutation = useMutation({
    mutationFn: async () => {
      return apiFetch<{ message: string }>('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email, code, newPassword }),
        skipAuth: true,
      })
    },
    onSuccess: () => {
      toast.success('Password reset successfully! Please log in.')
      navigate('/login')
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to reset password')
    },
  })

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    requestMutation.mutate()
  }

  const handleResetSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    resetMutation.mutate()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background-secondary py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h1 className="text-center text-3xl font-bold text-foreground">QMS</h1>
          <h2 className="mt-6 text-center text-2xl font-semibold text-foreground">
            Reset your password
          </h2>
        </div>

        {/* Step 1: Email */}
        {step === 'email' && (
          <form className="mt-8 space-y-6" onSubmit={handleEmailSubmit}>
            <div>
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                autoFocus
                className="mt-1"
              />
              <p className="mt-1 text-xs text-foreground-secondary">
                We'll send a reset code to this email
              </p>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={requestMutation.isPending}
            >
              {requestMutation.isPending ? 'Sending...' : 'Send reset code'}
            </Button>

            <p className="text-center text-sm text-foreground-secondary">
              Remember your password?{' '}
              <Link to="/login" className="text-blue-600 hover:text-blue-500 font-medium">
                Sign in
              </Link>
            </p>
          </form>
        )}

        {/* Step 2 & 3: Code + New Password */}
        {step === 'code' && (
          <form className="mt-8 space-y-6" onSubmit={handleResetSubmit}>
            <div className="space-y-4">
              <div>
                <Label htmlFor="code">Reset code</Label>
                <Input
                  id="code"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  required
                  autoFocus
                  maxLength={6}
                  className="mt-1 text-center text-2xl tracking-widest"
                />
                <p className="mt-1 text-xs text-foreground-secondary">
                  Enter the 6-digit code sent to {email}
                </p>
              </div>

              <div>
                <Label htmlFor="newPassword">New password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                  minLength={8}
                  className="mt-1"
                />
              </div>

              <div>
                <Label htmlFor="confirmPassword">Confirm new password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm your password"
                  required
                  minLength={8}
                  className="mt-1"
                />
              </div>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={resetMutation.isPending || code.length !== 6}
            >
              {resetMutation.isPending ? 'Resetting...' : 'Reset password'}
            </Button>

            <button
              type="button"
              onClick={() => setStep('email')}
              className="w-full text-center text-sm text-foreground-secondary hover:text-foreground"
            >
              Use a different email
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
