import { useState, useRef, useEffect, KeyboardEvent } from 'react'
import {
  MessageCircle,
  X,
  Send,
  Square,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronRight,
  Database,
  AlertCircle,
} from 'lucide-react'
import Markdown from 'react-markdown'
import { useChat, type ChatMessage, type ToolCall } from '@/api/hooks/useChat'

function ToolCallDisplay({ toolCall }: { toolCall: ToolCall }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const isLoading = !toolCall.result && !toolCall.isError

  // Try to parse result as JSON array for table rendering
  let rows: Record<string, unknown>[] | null = null
  if (toolCall.result && !toolCall.isError) {
    try {
      // Result format: "N row(s) returned:\n[...]"
      const jsonStart = toolCall.result.indexOf('[\n')
      if (jsonStart >= 0) {
        const jsonEnd = toolCall.result.lastIndexOf(']')
        if (jsonEnd > jsonStart) {
          const parsed = JSON.parse(toolCall.result.slice(jsonStart, jsonEnd + 1))
          if (Array.isArray(parsed) && parsed.length > 0) {
            rows = parsed
          }
        }
      }
    } catch {
      // Fall back to raw text
    }
  }

  const sql = toolCall.input?.sql as string | undefined
  const database = toolCall.input?.database as string | undefined

  return (
    <div className="my-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] text-xs overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 hover:bg-[var(--color-bg-hover)] transition-colors text-left"
      >
        {isLoading ? (
          <Loader2 className="h-3 w-3 animate-spin text-[var(--color-accent)]" />
        ) : toolCall.isError ? (
          <AlertCircle className="h-3 w-3 text-rose-500" />
        ) : (
          <Database className="h-3 w-3 text-[var(--color-accent)]" />
        )}
        <span className="font-medium text-[var(--color-text)]">
          {isLoading ? 'Running query' : toolCall.isError ? 'Query error' : 'SQL query'}
        </span>
        {database && (
          <span className="text-[var(--color-text-tertiary)] uppercase">
            [{database}]
          </span>
        )}
        <span className="ml-auto">
          {isExpanded ? (
            <ChevronDown className="h-3 w-3 text-[var(--color-text-tertiary)]" />
          ) : (
            <ChevronRight className="h-3 w-3 text-[var(--color-text-tertiary)]" />
          )}
        </span>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-[var(--color-border)]">
          {/* SQL query */}
          {sql && (
            <div className="px-2.5 py-2 bg-[var(--color-bg-secondary)]">
              <pre className="whitespace-pre-wrap break-all text-[var(--color-text-secondary)] font-mono text-[10px] leading-relaxed">
                {sql}
              </pre>
            </div>
          )}

          {/* Result */}
          {toolCall.isError && toolCall.result && (
            <div className="px-2.5 py-2 text-rose-500">
              {toolCall.result}
            </div>
          )}

          {rows && (
            <div className="overflow-x-auto max-h-48 overflow-y-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                    {Object.keys(rows[0]).map((col) => (
                      <th
                        key={col}
                        className="px-2 py-1 text-left font-medium text-[var(--color-text-secondary)] whitespace-nowrap"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 50).map((row, i) => (
                    <tr
                      key={i}
                      className="border-b border-[var(--color-border)] last:border-0"
                    >
                      {Object.values(row).map((val, j) => (
                        <td
                          key={j}
                          className="px-2 py-1 text-[var(--color-text)] whitespace-nowrap"
                        >
                          {val == null ? '' : String(val)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 50 && (
                <div className="px-2.5 py-1 text-[var(--color-text-tertiary)] text-center">
                  Showing 50 of {rows.length} rows
                </div>
              )}
            </div>
          )}

          {!toolCall.isError && toolCall.result && !rows && (
            <div className="px-2.5 py-2 text-[var(--color-text-secondary)]">
              <pre className="whitespace-pre-wrap break-all font-mono text-[10px]">
                {toolCall.result.substring(0, 2000)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          isUser
            ? 'bg-[var(--color-accent)] text-white'
            : 'bg-[var(--color-bg-secondary)] text-[var(--color-text)]'
        }`}
      >
        {/* Tool calls (shown before text for assistant messages) */}
        {!isUser && hasToolCalls && (
          <div className="mb-1">
            {message.toolCalls!.map((tc) => (
              <ToolCallDisplay key={tc.id} toolCall={tc} />
            ))}
          </div>
        )}

        {/* Message text */}
        {message.content && (
          isUser ? (
            <div className="whitespace-pre-wrap break-words leading-relaxed">
              {message.content}
            </div>
          ) : (
            <div className="chat-markdown break-words leading-relaxed prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 prose-headings:text-[var(--color-text)] prose-strong:text-[var(--color-text)] text-[var(--color-text)]">
              <Markdown>{message.content}</Markdown>
            </div>
          )
        )}

        {/* Empty assistant message still streaming */}
        {!isUser && !message.content && !hasToolCalls && (
          <div className="flex items-center gap-1.5 text-[var(--color-text-tertiary)]">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="text-xs">Thinking...</span>
          </div>
        )}
      </div>
    </div>
  )
}

export function ChatBubble() {
  const [isOpen, setIsOpen] = useState(false)
  const { messages, isStreaming, sendMessage, stopStreaming, clearMessages } = useChat()
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen])

  const handleSend = () => {
    const trimmed = input.trim()
    if (!trimmed || isStreaming) return
    setInput('')
    sendMessage(trimmed)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <>
      {/* Chat Panel */}
      {isOpen && (
        <div className="fixed bottom-20 right-6 z-50 flex flex-col w-[420px] h-[600px] max-h-[calc(100vh-120px)] rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-[var(--color-accent)]" />
              <span className="font-semibold text-sm text-[var(--color-text)]">
                AI Assistant
              </span>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  onClick={clearMessages}
                  className="p-1.5 rounded-md hover:bg-[var(--color-bg-hover)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text)] transition-colors"
                  title="Clear chat"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-md hover:bg-[var(--color-bg-hover)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text)] transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center text-[var(--color-text-tertiary)]">
                <MessageCircle className="h-10 w-10 mb-3 opacity-30" />
                <p className="text-sm font-medium text-[var(--color-text-secondary)]">
                  Ask me about your dashboards
                </p>
                <p className="text-xs mt-1.5 max-w-[280px]">
                  I can explain metrics, guide you to the right dashboard, and answer questions about your ERP.
                </p>
                <div className="mt-4 space-y-1.5 w-full max-w-[300px]">
                  {[
                    'How is OEE calculated?',
                    'Where can I see revenue by rep?',
                    'What does MSF mean?',
                    'Which dashboard shows inventory?',
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => {
                        setInput(suggestion)
                        setTimeout(() => inputRef.current?.focus(), 50)
                      }}
                      className="block w-full text-left text-xs px-3 py-2 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-[var(--color-border)] px-4 py-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about dashboards, metrics, or terms..."
                rows={1}
                className="flex-1 resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] max-h-24 overflow-y-auto"
                style={{ minHeight: '36px' }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement
                  target.style.height = 'auto'
                  target.style.height = Math.min(target.scrollHeight, 96) + 'px'
                }}
              />
              {isStreaming ? (
                <button
                  onClick={stopStreaming}
                  className="shrink-0 p-2 rounded-lg bg-rose-500 text-white hover:bg-rose-600 transition-colors"
                  title="Stop"
                >
                  <Square className="h-4 w-4" />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className="shrink-0 p-2 rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title="Send (Enter)"
                >
                  <Send className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Floating Bubble Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed bottom-6 right-6 z-50 flex items-center justify-center h-12 w-12 rounded-full shadow-lg transition-all hover:scale-105 ${
          isOpen
            ? 'bg-[var(--color-bg-secondary)] text-[var(--color-text)]'
            : 'bg-[var(--color-accent)] text-white'
        }`}
        title="AI Assistant"
      >
        {isOpen ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
      </button>
    </>
  )
}
