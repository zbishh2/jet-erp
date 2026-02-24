import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/api/client'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MicrosoftIcon } from '@/components/icons/MicrosoftIcon'
import { isMicrosoftAuthEnabled, getRedirectResult, startMicrosoftLogin } from '@/lib/msal'
import { toast } from 'sonner'

interface LoginResponse {
  token: string
  user: {
    id: string
    email: string
    displayName: string
    organizationId: string
    roles: string[]
  }
}

export function Login() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msLoading, setMsLoading] = useState(false)

  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null)

  // Handle Microsoft redirect response on mount
  useEffect(() => {
    const result = getRedirectResult()
    if (!result?.idToken) return

    setMsLoading(true)
    apiFetch<LoginResponse>('/auth/microsoft', {
      method: 'POST',
      body: JSON.stringify({ idToken: result.idToken }),
      skipAuth: true,
    })
      .then((data) => {
        login(data.token)
        navigate('/')
      })
      .catch((err: any) => {
        toast.error(err.message || 'Microsoft sign-in failed')
        setMsLoading(false)
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loginMutation = useMutation({
    mutationFn: async () => {
      return apiFetch<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
        skipAuth: true,
      })
    },
    onSuccess: (data) => {
      login(data.token)
      navigate('/')
    },
    onError: (error: any) => {
      const remaining = error?.data?.attemptsRemaining
      if (typeof remaining === 'number') {
        setAttemptsRemaining(remaining)
      }
      toast.error(error.message || 'Login failed')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    loginMutation.mutate()
  }

  if (msLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background-secondary py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8 text-center">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Jet Container</h1>
            <p className="mt-4 text-foreground-secondary">Completing Microsoft sign-in...</p>
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
            Sign in to your account
          </h2>
        </div>

        <div className="mt-8 space-y-6">
          {isMicrosoftAuthEnabled && (
            <>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => startMicrosoftLogin()}
              >
                <MicrosoftIcon className="mr-2" />
                Sign in with Microsoft
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

          <form className="space-y-6" onSubmit={handleSubmit}>
            <div className="space-y-4">
              <div>
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@jetcontainer.com"
                  required
                  autoFocus={!isMicrosoftAuthEnabled}
                  className="mt-1"
                />
              </div>

              <div>
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  className="mt-1"
                />
              </div>
            </div>

            {attemptsRemaining !== null && attemptsRemaining <= 3 && (
              <div className="rounded-md bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-200">
                {attemptsRemaining === 0
                  ? 'Your account has been temporarily locked. Please reset your password or try again later.'
                  : `${attemptsRemaining} login attempt${attemptsRemaining === 1 ? '' : 's'} remaining before your account is temporarily locked.`}
              </div>
            )}

            <div className="flex items-center justify-between">
              <Link
                to="/forgot-password"
                className="text-sm text-blue-600 hover:text-blue-500"
              >
                Forgot your password?
              </Link>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? 'Signing in...' : 'Sign in'}
            </Button>

            <p className="text-center text-sm text-foreground-secondary">
              Need an account? Contact your administrator for an invitation.
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}
