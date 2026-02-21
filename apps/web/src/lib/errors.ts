/**
 * Custom API error class with status code and user-friendly messages.
 */
export class ApiError extends Error {
  public readonly status: number
  public readonly code?: string
  public readonly isNetworkError: boolean
  public readonly data?: Record<string, unknown>

  constructor(
    message: string,
    status: number = 500,
    code?: string,
    isNetworkError: boolean = false,
    data?: Record<string, unknown>
  ) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.isNetworkError = isNetworkError
    this.data = data

    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, ApiError.prototype)
  }

  /**
   * Create an ApiError from a fetch response.
   */
  static async fromResponse(response: Response, payload?: unknown): Promise<ApiError> {
    let message = response.statusText
    let code: string | undefined
    let data: Record<string, unknown> | undefined

    if (payload && typeof payload === "object" && payload !== null) {
      const errorPayload = payload as { error?: string; message?: string; code?: string; [key: string]: unknown }
      message = errorPayload.error || errorPayload.message || message
      code = errorPayload.code
      // Preserve extra data from the error response (e.g., openItems)
      const { error: _e, message: _m, code: _c, ...rest } = errorPayload
      if (Object.keys(rest).length > 0) {
        data = rest
      }
    }

    // Provide user-friendly messages for common HTTP errors
    message = ApiError.getUserFriendlyMessage(response.status, message)

    return new ApiError(message, response.status, code, false, data)
  }

  /**
   * Create an ApiError from a network error.
   */
  static fromNetworkError(_error: Error): ApiError {
    return new ApiError(
      "Unable to connect to the server. Please check your internet connection.",
      0,
      "NETWORK_ERROR",
      true
    )
  }

  /**
   * Get a user-friendly message based on HTTP status code.
   */
  static getUserFriendlyMessage(status: number, originalMessage: string): string {
    switch (status) {
      case 400:
        return originalMessage || "The request was invalid. Please check your input and try again."
      case 401:
        return originalMessage || "Your session has expired. Please sign in again."
      case 403:
        return "You don't have permission to perform this action."
      case 404:
        return "The requested resource was not found."
      case 409:
        return originalMessage || "This operation conflicts with existing data. Please refresh and try again."
      case 422:
        return originalMessage || "The submitted data is invalid. Please check your input."
      case 429:
        return "Too many requests. Please wait a moment and try again."
      case 500:
        return "An internal server error occurred. Please try again later."
      case 502:
      case 503:
      case 504:
        return "The server is temporarily unavailable. Please try again later."
      default:
        return originalMessage || "An unexpected error occurred. Please try again."
    }
  }

  /**
   * Check if this error should trigger a retry.
   */
  get isRetryable(): boolean {
    return (
      this.isNetworkError ||
      this.status === 408 || // Request Timeout
      this.status === 429 || // Too Many Requests
      this.status === 502 || // Bad Gateway
      this.status === 503 || // Service Unavailable
      this.status === 504    // Gateway Timeout
    )
  }

  /**
   * Check if this error is an authentication error.
   */
  get isAuthError(): boolean {
    return this.status === 401
  }

  /**
   * Check if this error is a permission error.
   */
  get isPermissionError(): boolean {
    return this.status === 403
  }
}
