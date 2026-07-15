"use client"

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  DotsThreeIcon,
  ProhibitIcon,
  ShieldCheckIcon,
  UserIcon,
} from "@phosphor-icons/react"
import toast from "react-hot-toast"

import { AdminFilterBar } from "@/components/admin/admin-filter-bar"
import { AdminPageHeader } from "@/components/admin/admin-page-header"
import { AdminTablePagination } from "@/components/admin/admin-table-pagination"
import { SortableTableHead } from "@/components/admin/sortable-table-head"
import type { AdminListResponse, AdminUser } from "@/components/admin/types"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { authClient } from "@/lib/auth-client"
import { cn } from "@/lib/utils"

function useDebouncedValue<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(id)
  }, [value, delay])
  return debounced
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value))
}

export function UsersPanel() {
  const queryClient = useQueryClient()
  const [q, setQ] = React.useState("")
  const debouncedQ = useDebouncedValue(q)
  const [role, setRole] = React.useState("all")
  const [banned, setBanned] = React.useState("all")
  const [emailVerified, setEmailVerified] = React.useState("all")
  const [sortBy, setSortBy] = React.useState("createdAt")
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc")
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(20)

  React.useEffect(() => {
    setPage(1)
  }, [debouncedQ, role, banned, emailVerified, pageSize])

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: [
      "admin-users",
      debouncedQ,
      role,
      banned,
      emailVerified,
      sortBy,
      sortDir,
      page,
      pageSize,
    ],
    queryFn: async () => {
      const sp = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sortBy,
        sortDir,
      })
      if (debouncedQ) sp.set("q", debouncedQ)
      if (role !== "all") sp.set("role", role)
      if (banned !== "all") sp.set("banned", banned)
      if (emailVerified !== "all") sp.set("emailVerified", emailVerified)
      const res = await fetch(`/api/admin/users?${sp}`)
      if (!res.ok) throw new Error("Failed to load users")
      return res.json() as Promise<AdminListResponse<AdminUser>>
    },
    placeholderData: (prev) => prev,
  })

  const setRoleMutation = useMutation({
    mutationFn: async ({
      userId,
      nextRole,
    }: {
      userId: string
      nextRole: "admin" | "user"
    }) => {
      const res = await authClient.admin.setRole({
        userId,
        role: nextRole,
      })
      if (res.error) throw new Error(res.error.message || "Failed to set role")
    },
    onSuccess: async () => {
      toast.success("Role updated")
      await refetch()
      await queryClient.invalidateQueries({ queryKey: ["admin-stats"] })
    },
    onError: (err) => toast.error((err as Error).message),
  })

  const banMutation = useMutation({
    mutationFn: async ({
      userId,
      nextBanned,
    }: {
      userId: string
      nextBanned: boolean
    }) => {
      if (nextBanned) {
        const res = await authClient.admin.banUser({
          userId,
          banReason: "Banned by admin",
        })
        if (res.error) throw new Error(res.error.message || "Ban failed")
      } else {
        const res = await authClient.admin.unbanUser({ userId })
        if (res.error) throw new Error(res.error.message || "Unban failed")
      }
    },
    onSuccess: async () => {
      toast.success("User updated")
      await refetch()
      await queryClient.invalidateQueries({ queryKey: ["admin-stats"] })
    },
    onError: (err) => toast.error((err as Error).message),
  })

  function handleSort(column: string) {
    if (sortBy === column) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"))
    } else {
      setSortBy(column)
      setSortDir(
        column === "name" || column === "email" || column === "role"
          ? "asc"
          : "desc"
      )
    }
    setPage(1)
  }

  const items = data?.items ?? []
  const busy = setRoleMutation.isPending || banMutation.isPending

  return (
    <div>
      <AdminPageHeader
        title="Users"
        description="Search accounts, filter by role or status, and manage permissions."
      />

      <AdminFilterBar
        filterClassName="md:grid-cols-3"
        search={
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or email…"
            className="h-10"
          />
        }
        filters={
          <>
            <Select
              value={role}
              onValueChange={(value) => {
                if (value) setRole(value)
              }}
            >
              <SelectTrigger className="h-10 w-full min-w-0 border border-border/70 bg-background/50 px-3">
                <SelectValue placeholder="Role">
                  {role === "all"
                    ? "All roles"
                    : role === "admin"
                      ? "Admin"
                      : "User"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="user">User</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={banned}
              onValueChange={(value) => {
                if (value) setBanned(value)
              }}
            >
              <SelectTrigger className="h-10 w-full min-w-0 border border-border/70 bg-background/50 px-3">
                <SelectValue placeholder="Status">
                  {banned === "all"
                    ? "All statuses"
                    : banned === "true"
                      ? "Banned"
                      : "Active"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="false">Active</SelectItem>
                <SelectItem value="true">Banned</SelectItem>
              </SelectContent>
            </Select>
            <div className="col-span-2 md:col-span-1">
              <Select
                value={emailVerified}
                onValueChange={(value) => {
                  if (value) setEmailVerified(value)
                }}
              >
                <SelectTrigger className="h-10 w-full min-w-0 border border-border/70 bg-background/50 px-3">
                  <SelectValue placeholder="Email">
                    {emailVerified === "all"
                      ? "All emails"
                      : emailVerified === "true"
                        ? "Verified"
                        : "Unverified"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All emails</SelectItem>
                  <SelectItem value="true">Verified</SelectItem>
                  <SelectItem value="false">Unverified</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        }
      />

      <div
        className={cn(
          "overflow-hidden border border-border/60",
          isFetching && !isLoading && "opacity-80"
        )}
      >
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <SortableTableHead
                label="User"
                column="name"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortableTableHead
                label="Email"
                column="email"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={handleSort}
                className="hidden md:table-cell"
              />
              <SortableTableHead
                label="Role"
                column="role"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={handleSort}
                className="w-24 sm:w-28"
              />
              <SortableTableHead
                label="Favorites"
                column="favorites"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={handleSort}
                className="hidden w-28 lg:table-cell"
              />
              <TableHead className="hidden w-28 lg:table-cell">
                Verified
              </TableHead>
              <TableHead className="w-24 sm:w-28">Status</TableHead>
              <SortableTableHead
                label="Joined"
                column="createdAt"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={handleSort}
                className="hidden w-32 md:table-cell"
              />
              <TableHead className="w-12 text-right sm:w-16">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={8}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-10 text-center text-muted-foreground"
                >
                  No users match these filters.
                </TableCell>
              </TableRow>
            ) : (
              items.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <p className="font-medium">{user.name}</p>
                    <p className="truncate text-xs text-muted-foreground md:hidden">
                      {user.email}
                    </p>
                  </TableCell>
                  <TableCell className="hidden max-w-[220px] truncate text-muted-foreground md:table-cell">
                    {user.email}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "px-1.5 py-0.5 text-[0.6rem] font-semibold tracking-widest uppercase",
                        user.role === "admin"
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {user.role ?? "user"}
                    </span>
                  </TableCell>
                  <TableCell className="hidden tabular-nums lg:table-cell">
                    {user._count.favorites}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <span
                      className={cn(
                        "text-xs",
                        user.emailVerified
                          ? "text-foreground"
                          : "text-muted-foreground"
                      )}
                    >
                      {user.emailVerified ? "Verified" : "Unverified"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "px-1.5 py-0.5 text-[0.6rem] font-semibold tracking-widest uppercase",
                        user.banned
                          ? "bg-destructive/15 text-destructive"
                          : "bg-primary/15 text-primary"
                      )}
                    >
                      {user.banned ? "Banned" : "Active"}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                    {formatDate(user.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="inline-flex size-8 items-center justify-center border border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground"
                        aria-label={`Actions for ${user.name}`}
                      >
                        <DotsThreeIcon className="size-4" weight="bold" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-48">
                        <DropdownMenuItem
                          disabled={busy}
                          onClick={() =>
                            setRoleMutation.mutate({
                              userId: user.id,
                              nextRole:
                                user.role === "admin" ? "user" : "admin",
                            })
                          }
                        >
                          {user.role === "admin" ? (
                            <>
                              <UserIcon className="size-4" />
                              Make user
                            </>
                          ) : (
                            <>
                              <ShieldCheckIcon className="size-4" />
                              Make admin
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant={user.banned ? "default" : "destructive"}
                          disabled={busy}
                          onClick={() =>
                            banMutation.mutate({
                              userId: user.id,
                              nextBanned: !user.banned,
                            })
                          }
                        >
                          <ProhibitIcon className="size-4" />
                          {user.banned ? "Unban" : "Ban"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AdminTablePagination
        page={data?.page ?? page}
        totalPages={data?.totalPages ?? 1}
        total={data?.total ?? 0}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </div>
  )
}
