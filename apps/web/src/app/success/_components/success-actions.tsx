"use client"

import { buttonVariants } from "@crikket/ui/components/ui/button"
import { cn } from "@crikket/ui/lib/utils"
import Link from "next/link"

export function SuccessActions() {
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Link
        className={cn(buttonVariants({ size: "lg" }), "sm:flex-1")}
        href="/settings/billing"
      >
        View Billing Settings
      </Link>
      <Link
        className={cn(
          buttonVariants({ size: "lg", variant: "outline" }),
          "sm:flex-1"
        )}
        href="/"
      >
        Go to Dashboard
      </Link>
    </div>
  )
}
