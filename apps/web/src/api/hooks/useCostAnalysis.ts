import { useState, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { apiFetch, buildApiUrl } from '@/api/client'
import { getToken } from '@/lib/auth'
import { getCurrentOrgId, getCurrentModuleCode } from '@/api/client'

// ---------- Types ----------

export interface CostAnalysisRecord {
  id: string
  jobNumber: string | null
  specNumber: string | null
  customerName: string | null
  preCostPerM: number | null
  postCostPerM: number | null
  varianceAmount: number | null
  variancePct: number | null
  rootCauseCategory: string | null
  marginPct: number | null
  verdict: string | null
  report: string | null
  chatHistory: string | null
  status: string
  createdByUserId: string
  createdAt: string
  updatedAt: string
}

export interface ToolCall {
  id: string
  name: string
  input?: Record<string, unknown>
  result?: string
  isError?: boolean
}

export interface InvestigationMessage {
  id: string
  type: 'text' | 'tool'
  content: string
  toolCalls?: ToolCall[]
}

// ---------- CRUD Hooks ----------

interface ListResponse {
  data: CostAnalysisRecord[]
}

interface DetailResponse {
  data: CostAnalysisRecord
}

interface CreateResponse {
  data: { id: string }
}

export function useCostAnalyses() {
  return useQuery({
    queryKey: ['cost-analyses'],
    queryFn: () => apiFetch<ListResponse>('/erp/cost-analysis'),
    placeholderData: keepPreviousData,
  })
}

export function useCostAnalysis(id: string | undefined) {
  return useQuery({
    queryKey: ['cost-analysis', id],
    queryFn: () => apiFetch<DetailResponse>(`/erp/cost-analysis/${id}`),
    enabled: !!id,
  })
}

export function useSaveCostAnalysis() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<CreateResponse>('/erp/cost-analysis', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cost-analyses'] })
    },
  })
}

export function useDeleteCostAnalysis() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/erp/cost-analysis/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cost-analyses'] })
    },
  })
}

// ---------- SSE Investigation Hook ----------

export interface StatusUpdate {
  phase: string
  message: string
  elapsed?: number
  [key: string]: unknown
}

export function useInvestigation() {
  const [messages, setMessages] = useState<InvestigationMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [status, setStatus] = useState<StatusUpdate | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const investigate = useCallback(async (params: {
    jobNumber?: string
    specNumber?: string
    customerName?: string
    invoiceNumber?: string
  }) => {
    setMessages([])
    setStatus(null)
    setIsStreaming(true)

    const assistantId = crypto.randomUUID()
    setMessages([{ id: assistantId, type: 'text', content: '', toolCalls: [] }])

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      const token = getToken()
      if (token) headers['Authorization'] = `Bearer ${token}`
      const orgId = getCurrentOrgId()
      if (orgId) headers['X-Organization-Id'] = orgId
      const moduleCode = getCurrentModuleCode()
      if (moduleCode) headers['X-Module-Code'] = moduleCode

      const response = await fetch(buildApiUrl('/erp/cost-analysis/investigate'), {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text()
        let errorMessage = `Error: ${response.status}`
        try {
          const errorJson = JSON.parse(errorText)
          errorMessage = errorJson.error || errorMessage
        } catch { /* */ }
        setMessages([{ id: assistantId, type: 'text', content: errorMessage }])
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
                      m.id === assistantId
                        ? { ...m, content: m.content + data.content }
                        : m
                    )
                  )
                  break

                case 'tool_start':
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId
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
                      m.id === assistantId
                        ? {
                            ...m,
                            toolCalls: (m.toolCalls || []).map((tc) =>
                              tc.id === data.id
                                ? { ...tc, input: data.input, result: data.result, isError: data.isError }
                                : tc
                            ),
                          }
                        : m
                    )
                  )
                  break

                case 'status':
                  setStatus(data as StatusUpdate)
                  break

                case 'error':
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId
                        ? { ...m, content: m.content || `Error: ${data.message}` }
                        : m
                    )
                  )
                  setStatus({ phase: 'error', message: data.message, ...data })
                  break
              }
            } catch {
              // skip malformed
            }
            currentEvent = ''
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: m.content || 'Connection error. Please try again.' }
              : m
          )
        )
      }
    } finally {
      // Mark any stuck "Running query" tool calls as failed
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId && m.toolCalls?.some((tc) => !tc.result && !tc.isError)
            ? {
                ...m,
                toolCalls: m.toolCalls!.map((tc) =>
                  !tc.result && !tc.isError
                    ? { ...tc, result: 'Stream ended before result was received', isError: true }
                    : tc
                ),
              }
            : m
        )
      )
      setIsStreaming(false)
      abortRef.current = null
    }
  }, [])

  const stopInvestigation = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const clearMessages = useCallback(() => {
    setMessages([])
    setStatus(null)
  }, [])

  return { messages, isStreaming, status, investigate, stopInvestigation, clearMessages }
}
