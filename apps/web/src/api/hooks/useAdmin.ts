import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/api/client"

export interface OrgUser {
  id: string
  email: string
  displayName: string
  isActive: boolean
  createdAt: string
  roles: string[]
}

export interface OrgInvite {
  id: string
  email: string
  role: string
  token: string
  expiresAt: string
  createdAt: string
  usedAt: string | null
  usedByEmail: string | null
}

export function useOrgUsers() {
  return useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => apiFetch<{ users: OrgUser[] }>("/erp/admin/users"),
    select: (data) => data.users,
  })
}

export function useOrgInvites() {
  return useQuery({
    queryKey: ["admin", "invites"],
    queryFn: () => apiFetch<{ invites: OrgInvite[] }>("/erp/admin/invites"),
    select: (data) => data.invites,
  })
}

export function useCreateInvite() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { email: string; role: string }) =>
      apiFetch<{ token: string; signupUrl: string; email: string; role: string }>(
        "/erp/admin/invites",
        { method: "POST", body: JSON.stringify(data) }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin"] })
    },
  })
}

export function useUpdateUserRoles() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { userId: string; roles: string[] }) =>
      apiFetch<{ success: boolean }>(`/erp/admin/users/${data.userId}/roles`, {
        method: "PUT",
        body: JSON.stringify({ roles: data.roles }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
    },
  })
}

export function useUpdateUserRole() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { userId: string; role: string }) =>
      apiFetch<{ success: boolean }>(`/erp/admin/users/${data.userId}/role`, {
        method: "PUT",
        body: JSON.stringify({ role: data.role }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
    },
  })
}

export function useDeleteInvite() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (inviteId: string) =>
      apiFetch<{ success: boolean }>(`/erp/admin/invites/${inviteId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "invites"] })
    },
  })
}
