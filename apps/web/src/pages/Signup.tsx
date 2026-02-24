import { useState, useEffect } from 'react'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/api/client'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MicrosoftIcon } from '@/components/icons/MicrosoftIcon'
import { isMicrosoftAuthEnabled, getRedirectResult, startMicrosoftLogin } from '@/lib/msal'
import { toast } from 'sonner'

type Step = 'email' | 'verify' | 'password'

interface SignupStartResponse {
  message: string
  devCode?: string
}

interface CompleteSignupResponse {
  message: string
  token: string
  user: {
    id: string
    email: string
    displayName: string
    organizationId: string
    roles: string[]
  }
}

interface MicrosoftAuthResponse {
  token: string
  user: {
    id: string
    email: string
    displayName: string
    organizationId: string
    roles: string[]
  }
}

interface InviteInfo {
  email: string
  role: string
  organization: {
    id: string
    name: string
  }
  expiresAt: string
}

export function Signup() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const inviteToken = searchParams.get('invite')
  const { login } = useAuth()

  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [msLoading, setMsLoading] = useState(false)

  const inviteQuery = useQuery({
    queryKey: ['invite', inviteToken],
    queryFn: () => apiFetch<InviteInfo>(`/auth/invite/${inviteToken}`, { skipAuth: true }),
    enabled: !!inviteToken,
  })

  useEffect(() => {
    if (inviteQuery.data?.email) {
      setEmail(inviteQuery.data.email)
    }
  }, [inviteQuery.data])

  // Handle Microsoft redirect response on mount
  useEffect(() => {
    const result = getRedirectResult()
    if (!result?.idToken) return

    setMsLoading(true)
    // The inviteToken was passed as MSAL state and survives the redirect
    const stateInviteToken = result.state || undefined
    apiFetch<MicrosoftAuthResponse>('/auth/microsoft', {
      method: 'POST',
      body: JSON.stringify({ idToken: result.idToken, inviteToken: stateInviteToken }),
      skipAuth: true,
    })
      .then((data) => {
        login(data.token)
        toast.success('Account created successfully!')
        navigate('/')
      })
      .catch((err: any) => {
        toast.error(err.message || 'Microsoft sign-up failed')
        setMsLoading(false)
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const startMutation = useMutation({
    mutationFn: async () => {
      return apiFetch<SignupStartResponse>('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email, displayName }),
        skipAuth: true,
      })
    },
    onSuccess: (data) => {
      toast.success('Verification code sent to your email')
      if (data.devCode) {
        toast.info(`Dev mode - Code: ${data.devCode}`, { duration: 30000 })
      }
      setStep('verify')
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to send verification code')
    },
  })

  const verifyMutation = useMutation({
    mutationFn: async () => {
      return apiFetch<{ verified: boolean }>('/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ email, code }),
        skipAuth: true,
      })
    },
    onSuccess: () => {
      toast.success('Email verified!')
      setStep('password')
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Invalid verification code')
    },
  })

  const completeMutation = useMutation({
    mutationFn: async () => {
      return apiFetch<CompleteSignupResponse>('/auth/complete-signup', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
          displayName,
          inviteToken: inviteToken || undefined,
          code,
        }),
        skipAuth: true,
      })
    },
    onSuccess: (data) => {
      login(data.token)
      toast.success('Account created successfully!')
      navigate('/')
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create account')
    },
  })

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    startMutation.mutate()
  }

  const handleVerifySubmit = (e: React.FormEvent) => {
    e.preventDefault()
    verifyMutation.mutate()
  }

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    completeMutation.mutate()
  }

  if (!inviteToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background-secondary py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8 text-center">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Jet Container</h1>
            <h2 className="mt-6 text-2xl font-semibold text-foreground">
              Invite Required
            </h2>
            <p className="mt-4 text-foreground-secondary">
              This application is invite-only. Please contact your administrator to request an invitation.
            </p>
          </div>
          <div className="mt-8">
            <Link to="/login">
              <Button variant="outline" className="w-full">
                Back to Login
              </Button>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (inviteQuery.isError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background-secondary py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8 text-center">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Jet Container</h1>
            <h2 className="mt-6 text-2xl font-semibold text-foreground">
              Invalid or Expired Invite
            </h2>
            <p className="mt-4 text-foreground-secondary">
              This invitation link is invalid or has expired. Please contact your administrator to request a new invitation.
            </p>
          </div>
          <div className="mt-8">
            <Link to="/login">
              <Button variant="outline" className="w-full">
                Back to Login
              </Button>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (inviteQuery.isLoading || msLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background-secondary py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8 text-center">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Jet Container</h1>
            <p className="mt-4 text-foreground-secondary">
              {msLoading ? 'Completing Microsoft sign-up...' : 'Validating invitation...'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background-secondary py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h1 className="text-center text-3xl font-bold text-foreground">Jet Container</h1>
          <h2 className="mt-6 text-center text-2xl font-semibold text-foreground">
            Create your account
          </h2>
          {inviteQuery.data && (
            <p className="mt-2 text-center text-sm text-foreground-secondary">
              You've been invited to join <strong>{inviteQuery.data.organization.name}</strong> as <strong>{inviteQuery.data.role}</strong>
            </p>
          )}
        </div>

        {isMicrosoftAuthEnabled && (
          <>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => startMicrosoftLogin(inviteToken || undefined)}
            >
              <MicrosoftIcon className="mr-2" />
              Sign up with Microsoft
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background-secondary px-2 text-foreground-secondary">or</span>
              </div>
            </div>
          </>
        )}

        {/* Step indicator */}
        <div className="flex justify-center space-x-4">
          {(['email', 'verify', 'password'] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  step === s
                    ? 'bg-blue-600 text-white'
                    : i < ['email', 'verify', 'password'].indexOf(step)
                    ? 'bg-green-500 text-white'
                    : 'bg-background-tertiary text-foreground-secondary'
                }`}
              >
                {i + 1}
              </div>
              {i < 2 && <div className="w-12 h-0.5 bg-background-tertiary mx-2" />}
            </div>
          ))}
        </div>

        {step === 'email' && (
          <form className="mt-8 space-y-6" onSubmit={handleEmailSubmit}>
            <div className="space-y-4">
              <div>
                <Label htmlFor="displayName">Your name</Label>
                <Input
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="John Smith"
                  required
                  autoFocus
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="email">Work email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@jetcontainer.com"
                  required
                  disabled={!!inviteQuery.data}
                  className="mt-1"
                />
                <p className="mt-1 text-xs text-foreground-secondary">
                  We'll send a verification code to this email
                </p>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={startMutation.isPending}>
              {startMutation.isPending ? 'Sending code...' : 'Continue'}
            </Button>
            <p className="text-center text-sm text-foreground-secondary">
              Already have an account?{' '}
              <Link to="/login" className="text-blue-600 hover:text-blue-500 font-medium">
                Sign in
              </Link>
            </p>
          </form>
        )}

        {step === 'verify' && (
          <form className="mt-8 space-y-6" onSubmit={handleVerifySubmit}>
            <div className="space-y-4">
              <div>
                <Label htmlFor="code">Verification code</Label>
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
            </div>
            <Button type="submit" className="w-full" disabled={verifyMutation.isPending || code.length !== 6}>
              {verifyMutation.isPending ? 'Verifying...' : 'Verify'}
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

        {step === 'password' && (
          <form className="mt-8 space-y-6" onSubmit={handlePasswordSubmit}>
            <div className="space-y-4">
              <div>
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                  autoFocus
                  minLength={8}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="confirmPassword">Confirm password</Label>
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
            <Button type="submit" className="w-full" disabled={completeMutation.isPending}>
              {completeMutation.isPending ? 'Creating account...' : 'Create account'}
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
