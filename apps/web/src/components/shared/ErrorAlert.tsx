import { Button } from "@/components/ui"

interface ErrorAlertProps {
  error: string
  onDismiss?: () => void
}

export function ErrorAlert({ error, onDismiss }: ErrorAlertProps) {
  return (
    <div className="flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <span>{error}</span>
      {onDismiss && (
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      )}
    </div>
  )
}
