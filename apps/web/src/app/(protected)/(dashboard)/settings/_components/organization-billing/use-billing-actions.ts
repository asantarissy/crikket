import { useMutation } from "@tanstack/react-query"
import { useRouter } from "nextjs-toploader/app"
import * as React from "react"
import { toast } from "sonner"

import { setCheckoutPendingGuard } from "@/lib/billing-checkout-guard"
import { client } from "@/utils/orpc"

import type { BillingInterval, SwitchablePlan } from "./types"
import { extractRedirectUrl, getErrorMessage } from "./utils"

interface UseBillingActionsInput {
  organizationId: string
  billingInterval: BillingInterval
}

export function useBillingActions(input: UseBillingActionsInput) {
  const router = useRouter()
  const [pendingPlan, setPendingPlan] = React.useState<SwitchablePlan | null>(
    null
  )
  const [isPlanConfirmOpen, setIsPlanConfirmOpen] = React.useState(false)

  const changePlanMutation = useMutation({
    mutationFn: async (nextPlan: SwitchablePlan) => {
      const data = await client.billing.changePlan({
        billingInterval: input.billingInterval,
        organizationId: input.organizationId,
        plan: nextPlan,
      })

      if (data.action === "checkout_required") {
        setCheckoutPendingGuard()
        window.location.assign(data.url)
      }

      return data
    },
    onSuccess: (data, nextPlan) => {
      if (data.action === "checkout_required") {
        return
      }

      if (data.action === "updated") {
        toast.success(
          `Organization plan updated to ${nextPlan === "pro" ? "Pro" : "Studio"}.`
        )
      } else {
        toast.message("Organization is already on that plan.")
      }

      router.refresh()
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, "Failed to change plan"))
    },
  })

  const portalMutation = useMutation({
    mutationFn: async () => {
      const data = await client.billing.openPortal({
        organizationId: input.organizationId,
      })
      const url = extractRedirectUrl(data)
      if (!url) {
        throw new Error("Portal URL is missing from response.")
      }

      window.location.assign(url)
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, "Failed to open billing portal"))
    },
  })

  const handlePlanDialogOpenChange = (open: boolean) => {
    setIsPlanConfirmOpen(open)
    if (!open) {
      setPendingPlan(null)
    }
  }

  return {
    pendingPlan,
    isPlanConfirmOpen,
    isMutating: changePlanMutation.isPending || portalMutation.isPending,
    isPlanChangePending: changePlanMutation.isPending,
    handlePlanDialogOpenChange,
    handlePlanSelection: (nextPlan: SwitchablePlan) => {
      setPendingPlan(nextPlan)
      setIsPlanConfirmOpen(true)
    },
    handleConfirmPlanChange: async () => {
      if (!pendingPlan) {
        return
      }

      await changePlanMutation.mutateAsync(pendingPlan)
    },
    openPortal: () => portalMutation.mutate(),
  }
}
