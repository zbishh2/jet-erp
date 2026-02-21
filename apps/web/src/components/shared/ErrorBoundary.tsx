import { Component, type ReactNode } from "react"
import { AlertTriangle, RefreshCw, Home } from "lucide-react"
import { Button } from "@/components/ui"

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log error to console in development
    console.error("ErrorBoundary caught an error:", error, errorInfo)

    // In production, you would send this to an error tracking service
    // e.g., Sentry.captureException(error, { extra: errorInfo })
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  handleGoHome = () => {
    window.location.href = "/"
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-background-secondary px-4">
          <div className="max-w-md w-full bg-background rounded-lg shadow-lg p-8 text-center">
            <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-6">
              <AlertTriangle className="h-8 w-8 text-red-600" aria-hidden="true" />
            </div>

            <h1 className="text-2xl font-semibold text-foreground mb-2">
              Something went wrong
            </h1>

            <p className="text-foreground-secondary mb-6">
              An unexpected error occurred. Please try again or return to the home page.
            </p>

            {process.env.NODE_ENV === "development" && this.state.error && (
              <div className="mb-6 p-4 bg-background-tertiary rounded-md text-left">
                <p className="text-sm font-mono text-red-600 break-all">
                  {this.state.error.message}
                </p>
              </div>
            )}

            <div className="flex gap-3 justify-center">
              <Button variant="outline" onClick={this.handleRetry}>
                <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
                Try Again
              </Button>
              <Button onClick={this.handleGoHome}>
                <Home className="h-4 w-4 mr-2" aria-hidden="true" />
                Go Home
              </Button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
