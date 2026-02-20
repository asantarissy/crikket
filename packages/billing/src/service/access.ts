import { db } from "@crikket/db"
import { member } from "@crikket/db/schema/auth"
import { ORPCError } from "@orpc/server"
import { and, eq } from "drizzle-orm"

export async function assertUserBelongsToOrganization(input: {
  organizationId: string
  userId: string
}): Promise<void> {
  const organizationMember = await db.query.member.findFirst({
    where: and(
      eq(member.organizationId, input.organizationId),
      eq(member.userId, input.userId)
    ),
    columns: {
      id: true,
    },
  })

  if (!organizationMember) {
    throw new ORPCError("FORBIDDEN", {
      message: "You do not have access to this organization.",
    })
  }
}

export async function assertUserCanManageOrganizationBilling(input: {
  organizationId: string
  userId: string
}): Promise<void> {
  const membership = await db.query.member.findFirst({
    where: and(
      eq(member.organizationId, input.organizationId),
      eq(member.userId, input.userId)
    ),
    columns: {
      role: true,
    },
  })

  if (!membership) {
    throw new ORPCError("FORBIDDEN", {
      message: "You do not have access to this organization.",
    })
  }

  if (membership.role !== "owner") {
    throw new ORPCError("FORBIDDEN", {
      message: "Only organization owners can manage billing.",
    })
  }
}
