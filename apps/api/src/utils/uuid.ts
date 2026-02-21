// UUID generation utility for D1/SQLite
// crypto.randomUUID() is available in Cloudflare Workers

export function generateUUID(): string {
  return crypto.randomUUID()
}
