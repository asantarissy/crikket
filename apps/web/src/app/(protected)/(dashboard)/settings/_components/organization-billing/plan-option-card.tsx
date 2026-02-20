import { Badge } from "@crikket/ui/components/ui/badge"
import { Button } from "@crikket/ui/components/ui/button"

import type { PlanOption, PlanOptionCardContext, SwitchablePlan } from "./types"
import {
  formatMoney,
  formatPlanLabel,
  planBadgeVariant,
  resolvePriceByInterval,
} from "./utils"

interface PlanOptionCardProps {
  context: PlanOptionCardContext
  option: PlanOption
  onSelect: (nextPlan: SwitchablePlan) => void
}

export function PlanOptionCard(props: PlanOptionCardProps) {
  const { context, option } = props
  const isCurrentPlan =
    context.currentPlan === option.slug &&
    context.currentBillingInterval === context.billingInterval

  return (
    <div className="rounded-xl border p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{formatPlanLabel(option.slug)}</p>
        {isCurrentPlan ? (
          <Badge variant={planBadgeVariant(option.slug)}>Current</Badge>
        ) : null}
      </div>
      <p className="mt-1 text-muted-foreground text-sm">{option.description}</p>
      <p className="mt-2 font-medium text-sm">
        {formatMoney(
          resolvePriceByInterval(option.prices, context.billingInterval),
          context.billingInterval
        )}
      </p>

      <Button
        className="mt-3"
        disabled={
          context.isMutating || isCurrentPlan || !context.canManageBilling
        }
        onClick={() => props.onSelect(option.slug)}
        variant={isCurrentPlan ? "outline" : "default"}
      >
        {isCurrentPlan ? "Current plan" : "Select plan"}
      </Button>
    </div>
  )
}
