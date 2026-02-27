import { useState, useCallback, useRef } from 'react'
import { buildApiUrl } from '@/api/client'
import { getToken } from '@/lib/auth'
import { getCurrentOrgId, getCurrentModuleCode } from '@/api/client'

export interface ToolCall {
  id: string
  name: string
  input?: Record<string, unknown>
  result?: string
  isError?: boolean
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCall[]
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const sendMessage = useCallback(async (text: string) => {
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
    }

    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      toolCalls: [],
    }

    setMessages((prev) => [...prev, userMessage, assistantMessage])
    setIsStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      // Build conversation history (just role + content for the API)
      const apiMessages = [...messages, userMessage].map((m) => ({
        role: m.role,
        content: m.content,
      }))

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      const token = getToken()
      if (token) headers['Authorization'] = `Bearer ${token}`
      const orgId = getCurrentOrgId()
      if (orgId) headers['X-Organization-Id'] = orgId
      const moduleCode = getCurrentModuleCode()
      if (moduleCode) headers['X-Module-Code'] = moduleCode

      const response = await fetch(buildApiUrl('/erp/chat'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ messages: apiMessages }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text()
        let errorMessage = `Error: ${response.status}`
        try {
          const errorJson = JSON.parse(errorText)
          errorMessage = errorJson.error || errorJson.message || errorMessage
        } catch {
          // use status-based message
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessage.id
              ? { ...m, content: errorMessage }
              : m
          )
        )
        setIsStreaming(false)
        return
      }

      const reader = response.body?.getReader()
      if (!reader) {
        setIsStreaming(false)
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        let currentEvent = ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim()
          } else if (line.startsWith('data: ') && currentEvent) {
            const dataStr = line.slice(6).trim()
            if (!dataStr) continue

            try {
              const data = JSON.parse(dataStr)

              switch (currentEvent) {
                case 'text':
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMessage.id
                        ? { ...m, content: m.content + data.content }
                        : m
                    )
                  )
                  break

                case 'tool_start':
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMessage.id
                        ? {
                            ...m,
                            toolCalls: [
                              ...(m.toolCalls || []),
                              { id: data.id, name: data.name },
                            ],
                          }
                        : m
                    )
                  )
                  break

                case 'tool_result':
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMessage.id
                        ? {
                            ...m,
                            toolCalls: (m.toolCalls || []).map((tc) =>
                              tc.id === data.id
                                ? {
                                    ...tc,
                                    input: data.input,
                                    result: data.result,
                                    isError: data.isError,
                                  }
                                : tc
                            ),
                          }
                        : m
                    )
                  )
                  break

                case 'error':
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMessage.id
                        ? {
                            ...m,
                            content: m.content || `Error: ${data.message}`,
                          }
                        : m
                    )
                  )
                  break
              }
            } catch {
              // skip malformed events
            }
            currentEvent = ''
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessage.id
              ? { ...m, content: m.content || 'Connection error. Please try again.' }
              : m
          )
        )
      }
    } finally {
      setIsStreaming(false)
      abortRef.current = null
    }
  }, [messages])

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const clearMessages = useCallback(() => {
    setMessages([])
  }, [])

  return { messages, isStreaming, sendMessage, stopStreaming, clearMessages }
}
