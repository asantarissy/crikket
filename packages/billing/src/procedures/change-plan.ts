import { z } from "zod"

import { changeOrganizationPlan } from "../service/checkout"
import { protectedProcedure } from "./context"
import {
  optionalOrganizationIdInputSchema,
  resolveOrganizationId,
} from "./organization-id"

const changePlanInputSchema = optionalOrganizationIdInputSchema.extend({
  billingInterval: z.enum(["monthly", "yearly"]).default("monthly"),
  plan: z.enum(["pro", "studio"]),
})

export const changePlan = protectedProcedure
  .input(changePlanInputSchema)
  .handler(({ context, input }) => {
    const organizationId = resolveOrganizationId({
      organizationId: input.organizationId,
      activeOrganizationId: context.session.session.activeOrganizationId,
    })

    return changeOrganizationPlan({
      billingInterval: input.billingInterval,
      organizationId,
      plan: input.plan,
      userId: context.session.user.id,
    })
  })
