import { authClient } from "@crikket/auth/client"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@crikket/ui/components/ui/card"
import type { Metadata } from "next"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { getProtectedAuthData } from "@/app/(protected)/_lib/get-protected-auth-data"
import { client } from "@/utils/orpc"

import { OrganizationMembersSection } from "../_components/org-members/organization-members-section"
import { OrganizationDangerZone } from "../_components/organization-danger-zone"
import { OrganizationSettingsForm } from "../_components/organization-settings-form"
import { getRequestErrorMessage } from "../_lib/get-request-error-message"
import { parseMembersQuery } from "../_lib/members-query"

export const metadata: Metadata = {
  title: "Organization Settings",
  description: "Manage your organization profile, members, and invitations.",
}

interface OrganizationSettingsPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

type MembersListOptions = NonNullable<
  Parameters<typeof authClient.organization.listMembers>[0]
>
type MembersListQuery = NonNullable<MembersListOptions["query"]>
type MembersListResult = Awaited<
  ReturnType<typeof authClient.organization.listMembers>
>
type OrganizationMember = NonNullable<
  NonNullable<MembersListResult["data"]>["members"]
>[number]
type BillingSnapshot = Awaited<
  ReturnType<typeof client.billing.getCurrentOrganizationPlan>
>
function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}

export default async function OrganizationSettingsPage({
  searchParams,
}: OrganizationSettingsPageProps) {
  const resolvedSearchParams = await searchParams
  const membersQuery = parseMembersQuery(resolvedSearchParams)
  const { organizations, session } = await getProtectedAuthData()

  if (!session) {
    redirect("/login")
  }

  if (organizations.length === 0) {
    redirect("/onboarding")
  }

  const activeOrganization =
    organizations.find(
      (organization) => organization.id === session.session.activeOrganizationId
    ) ?? organizations[0]

  const requestHeaders = await headers()
  const authFetchOptions = {
    fetchOptions: {
      headers: requestHeaders,
    },
  }
  const membersListQuery: MembersListQuery = {
    organizationId: activeOrganization.id,
    limit: membersQuery.perPage,
    offset: membersQuery.offset,
    sortBy: "createdAt",
    sortDirection: "desc",
  }

  const membersPromise: Promise<MembersListResult> = membersQuery.search
    ? (async () => {
        const initialMembersResponse =
          await authClient.organization.listMembers({
            query: {
              ...membersListQuery,
              limit: 1,
              offset: 0,
            },
            ...authFetchOptions,
          })
        if (initialMembersResponse.error || !initialMembersResponse.data) {
          return initialMembersResponse
        }

        const fullMembersResponse = await authClient.organization.listMembers({
          query: {
            ...membersListQuery,
            limit: Math.max(1, initialMembersResponse.data.total),
            offset: 0,
          },
          ...authFetchOptions,
        })
        if (fullMembersResponse.error || !fullMembersResponse.data) {
          return fullMembersResponse
        }

        const normalizedSearch = (membersQuery.search ?? "")
          .trim()
          .toLowerCase()
        const matchedMembers = fullMembersResponse.data.members.filter(
          (member) => member.user.email.toLowerCase().includes(normalizedSearch)
        )
        const paginatedMembers = matchedMembers.slice(
          membersQuery.offset,
          membersQuery.offset + membersQuery.perPage
        )

        return {
          ...fullMembersResponse,
          data: {
            ...fullMembersResponse.data,
            members: paginatedMembers,
            total: matchedMembers.length,
          },
        }
      })()
    : authClient.organization.listMembers({
        query: membersListQuery,
        ...authFetchOptions,
      })
  const billingPromise: Promise<{
    data: BillingSnapshot | null
    error: unknown
  }> = client.billing
    .getCurrentOrganizationPlan({
      organizationId: activeOrganization.id,
    })
    .then((data) => ({
      data,
      error: null,
    }))
    .catch((error) => ({
      data: null,
      error,
    }))
  const [
    { data: memberRoleData },
    { data: membersData, error: membersError },
    { data: invitationData, error: invitationError },
    billingState,
  ] = await Promise.all([
    authClient.organization.getActiveMemberRole({
      query: {
        organizationId: activeOrganization.id,
      },
      ...authFetchOptions,
    }),
    membersPromise,
    authClient.organization.listInvitations({
      query: {
        organizationId: activeOrganization.id,
      },
      ...authFetchOptions,
    }),
    billingPromise,
  ])
  const currentBillingPlan = billingState.data?.plan ?? "free"
  const memberCap = billingState.data?.entitlements.memberCap ?? null

  const members = (membersData?.members ?? []).map(
    (member: OrganizationMember) => ({
      memberId: member.id,
      userId: member.userId,
      name: member.user.name,
      email: member.user.email,
      role: member.role,
      joinedAt: toIsoString(member.createdAt),
    })
  )
  const pendingInvitations = (invitationData ?? [])
    .filter((invitation) => invitation.status === "pending")
    .map((invitation) => ({
      invitationId: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      createdAt: toIsoString(invitation.createdAt),
      expiresAt: toIsoString(invitation.expiresAt),
    }))

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold text-xl tracking-tight">
          Organization Settings
        </h2>
        <p className="mt-1 text-muted-foreground text-sm">
          Manage workspace identity, memberships, and invitations.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Organization Profile</CardTitle>
          <CardDescription>
            Keep your organization name and slug in sync.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OrganizationSettingsForm
            initialName={activeOrganization.name}
            initialSlug={activeOrganization.slug}
            organizationId={activeOrganization.id}
          />
        </CardContent>
      </Card>

      <OrganizationMembersSection
        currentPlan={currentBillingPlan}
        currentUserId={session.user.id}
        currentUserRole={memberRoleData?.role ?? "member"}
        memberCap={memberCap}
        members={members}
        organizationId={activeOrganization.id}
        pendingInvitations={pendingInvitations}
        totalMembers={membersData?.total ?? 0}
      />

      <OrganizationDangerZone
        currentUserRole={memberRoleData?.role ?? "member"}
        organizationId={activeOrganization.id}
        organizationName={activeOrganization.name}
      />

      {membersError ? (
        <p className="text-destructive text-sm">
          Failed to load members: {getRequestErrorMessage(membersError)}
        </p>
      ) : null}
      {invitationError ? (
        <p className="text-destructive text-sm">
          Failed to load invitations: {invitationError.message}
        </p>
      ) : null}
      {billingState.error ? (
        <p className="text-destructive text-sm">
          Failed to load billing: {getRequestErrorMessage(billingState.error)}
        </p>
      ) : null}
    </div>
  )
}
