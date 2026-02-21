import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/api/client'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
    onError: (error: Error) => {
      toast.error(error.message || 'Login failed')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    loginMutation.mutate()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background-secondary py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h1 className="text-center text-3xl font-bold text-foreground">Jet Container ERP</h1>
          <h2 className="mt-6 text-center text-2xl font-semibold text-foreground">
            Sign in to your account
          </h2>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
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
                autoFocus
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
  )
}
