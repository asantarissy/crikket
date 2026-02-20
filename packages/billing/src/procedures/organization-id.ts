import { ORPCError } from "@orpc/server"
import { z } from "zod"

export const optionalOrganizationIdInputSchema = z.object({
  organizationId: z.string().min(1).optional(),
})

export function resolveOrganizationId(input: {
  organizationId?: string
  activeOrganizationId?: string | null
}): string {
  const organizationId = input.organizationId ?? input.activeOrganizationId
  if (!organizationId) {
    throw new ORPCError("BAD_REQUEST", { message: "No active organization" })
  }

  return organizationId
}
