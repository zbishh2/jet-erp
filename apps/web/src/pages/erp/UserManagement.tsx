import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, Copy, Trash2, UserPlus } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  useOrgUsers,
  useOrgInvites,
  useCreateInvite,
  useDeleteInvite,
  useUpdateUserRoles,
} from "@/api/hooks/useAdmin"
import { cn } from "@/lib/utils"

const ALL_ROLES = ["VIEWER", "ESTIMATOR", "FINANCE", "ADMIN"] as const

const INVITE_ROLES = [
  { value: "VIEWER", label: "Viewer" },
  { value: "ESTIMATOR", label: "Estimator" },
  { value: "FINANCE", label: "Finance" },
  { value: "ADMIN", label: "Admin" },
]

function getInviteStatus(invite: { usedAt: string | null; expiresAt: string }) {
  if (invite.usedAt) return "used"
  if (new Date(invite.expiresAt) < new Date()) return "expired"
  return "pending"
}

function InviteStatusBadge({ status, usedByEmail }: { status: string; usedByEmail?: string | null }) {
  const variant = status === "used" ? "success" : status === "expired" ? "destructive" : "warning"
  const label = status === "used" && usedByEmail ? `Used by ${usedByEmail}` : status
  return <Badge variant={variant} className="capitalize">{label}</Badge>
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function RoleBadges({ userId, currentRoles }: { userId: string; currentRoles: string[] }) {
  const updateRoles = useUpdateUserRoles()

  const toggleRole = (role: string) => {
    const newRoles = currentRoles.includes(role)
      ? currentRoles.filter(r => r !== role)
      : [...currentRoles, role]

    updateRoles.mutate(
      { userId, roles: newRoles },
      {
        onSuccess: () => toast.success("Roles updated"),
        onError: (err) => toast.error(err.message || "Failed to update roles"),
      }
    )
  }

  return (
    <div className="flex gap-1">
      {ALL_ROLES.map((role) => {
        const isActive = currentRoles.includes(role)
        return (
          <button
            key={role}
            onClick={() => toggleRole(role)}
            disabled={updateRoles.isPending}
            className={cn(
              "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium transition-colors cursor-pointer border",
              isActive
                ? "bg-primary/10 text-primary border-primary/30 hover:bg-primary/20"
                : "bg-transparent text-foreground-tertiary border-border hover:bg-background-hover hover:text-foreground-secondary"
            )}
          >
            {role}
          </button>
        )
      })}
    </div>
  )
}

export default function UserManagement() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState("users")
  const [email, setEmail] = useState("")
  const [role, setRole] = useState("VIEWER")
  const [lastSignupUrl, setLastSignupUrl] = useState<string | null>(null)

  const { data: users, isLoading: usersLoading } = useOrgUsers()
  const { data: invites, isLoading: invitesLoading } = useOrgInvites()
  const createInvite = useCreateInvite()
  const deleteInvite = useDeleteInvite()

  const handleCreateInvite = () => {
    if (!email.trim()) return
    createInvite.mutate(
      { email: email.trim(), role },
      {
        onSuccess: (data) => {
          setLastSignupUrl(data.signupUrl)
          setEmail("")
          toast.success(`Invite created for ${data.email}`)
        },
        onError: (err) => {
          toast.error(err.message || "Failed to create invite")
        },
      }
    )
  }

  const handleCopyUrl = () => {
    if (!lastSignupUrl) return
    navigator.clipboard.writeText(lastSignupUrl)
    toast.success("Signup URL copied to clipboard")
  }

  const handleDeleteInvite = (inviteId: string) => {
    deleteInvite.mutate(inviteId, {
      onSuccess: () => toast.success("Invite deleted"),
      onError: (err) => toast.error(err.message || "Failed to delete invite"),
    })
  }

  return (
    <div className="h-full flex -mx-6 -mt-6">
      <div className="flex-1 px-6 pt-3 overflow-auto">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
          {/* Header */}
          <div className="flex items-center gap-3 pb-2 mb-3 border-b border-border">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <span className="text-sm font-medium truncate max-w-xs">User Management</span>
            <TabsList>
              <TabsTrigger value="users">Users</TabsTrigger>
              <TabsTrigger value="invites">Invites</TabsTrigger>
            </TabsList>
          </div>

          {/* Users Tab */}
          <TabsContent value="users" className="flex-1 space-y-6 pb-6">
            <div className="border border-border rounded-lg p-4 bg-background-secondary">
              <h3 className="text-base font-semibold mb-4">Organization Users</h3>
              {usersLoading ? (
                <p className="text-sm text-foreground-secondary">Loading...</p>
              ) : !users?.length ? (
                <p className="text-sm text-foreground-secondary">No users yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Roles</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Joined</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((u) => (
                      <TableRow key={u.id} className="h-8">
                        <TableCell className="py-0.5 font-medium">{u.displayName}</TableCell>
                        <TableCell className="py-0.5">{u.email}</TableCell>
                        <TableCell className="py-0.5">
                          <RoleBadges userId={u.id} currentRoles={u.roles} />
                        </TableCell>
                        <TableCell className="py-0.5">
                          <Badge variant={u.isActive ? "success" : "destructive"}>
                            {u.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-0.5 text-foreground-secondary">{formatDate(u.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </TabsContent>

          {/* Invites Tab */}
          <TabsContent value="invites" className="flex-1 space-y-6 pb-6">
            {/* Create Invite */}
            <div className="border border-border rounded-lg p-4 bg-background-secondary">
              <h3 className="text-base font-semibold mb-4">Create Invite</h3>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-sm text-foreground-secondary">Email</label>
                    <Input
                      type="email"
                      className="border-0 bg-transparent px-0"
                      placeholder="user@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleCreateInvite()}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm text-foreground-secondary">Role</label>
                    <Select value={role} onValueChange={setRole}>
                      <SelectTrigger className="border-0 bg-transparent px-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {INVITE_ROLES.map((r) => (
                          <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button onClick={handleCreateInvite} disabled={createInvite.isPending || !email.trim()} size="sm">
                  <UserPlus className="mr-2 h-4 w-4" />
                  Create Invite
                </Button>
                {lastSignupUrl && (
                  <div className="flex items-center gap-2 pt-2 border-t border-border">
                    <Input readOnly value={lastSignupUrl} className="font-mono text-xs border-0 bg-transparent px-0" />
                    <Button variant="ghost" size="icon" onClick={handleCopyUrl}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Pending Invites */}
            <div className="border border-border rounded-lg p-4 bg-background-secondary">
              <h3 className="text-base font-semibold mb-4">Invite History</h3>
              {invitesLoading ? (
                <p className="text-sm text-foreground-secondary">Loading...</p>
              ) : !invites?.length ? (
                <p className="text-sm text-foreground-secondary">No invites yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-20"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invites.map((invite) => {
                      const status = getInviteStatus(invite)
                      return (
                        <TableRow key={invite.id} className="h-8">
                          <TableCell className="py-0.5 font-medium">{invite.email}</TableCell>
                          <TableCell className="py-0.5">
                            <Badge variant="outline">{invite.role}</Badge>
                          </TableCell>
                          <TableCell className="py-0.5 text-foreground-secondary">{formatDate(invite.createdAt)}</TableCell>
                          <TableCell className="py-0.5 text-foreground-secondary">{formatDate(invite.expiresAt)}</TableCell>
                          <TableCell className="py-0.5">
                            <InviteStatusBadge status={status} usedByEmail={invite.usedByEmail} />
                          </TableCell>
                          <TableCell className="py-0.5">
                            {status === "pending" && (
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => {
                                    const url = `${window.location.origin}/signup?invite=${invite.token}`
                                    navigator.clipboard.writeText(url)
                                    toast.success("Invite link copied")
                                  }}
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => handleDeleteInvite(invite.id)}
                                  disabled={deleteInvite.isPending}
                                >
                                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
