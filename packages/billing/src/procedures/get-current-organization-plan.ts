import { assertUserBelongsToOrganization } from "../service/access"
import { getOrganizationBillingSnapshot } from "../service/entitlements"
import { protectedProcedure } from "./context"
import {
  optionalOrganizationIdInputSchema,
  resolveOrganizationId,
} from "./organization-id"

export const getCurrentOrganizationPlan = protectedProcedure
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

    return getOrganizationBillingSnapshot(organizationId)
  })
