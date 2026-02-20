import { assertUserBelongsToOrganization } from "../service/access"
import { getOrganizationEntitlements } from "../service/entitlements"
import { protectedProcedure } from "./context"
import {
  optionalOrganizationIdInputSchema,
  resolveOrganizationId,
} from "./organization-id"

export const getEntitlements = protectedProcedure
  .input(optionalOrganizationIdInputSchema)
  .handler(async ({ context, input }) => {
    const organizationId = resolveOrganizationId({
      organizationId: input.organizationId,
      activeOrganizationId: context.session.session.activeOrganizationId,
    })

    await assertUserBelongsToOrganization({
      organizationId,
      userId: context.session.user.id,
    })

    return getOrganizationEntitlements(organizationId)
  })
