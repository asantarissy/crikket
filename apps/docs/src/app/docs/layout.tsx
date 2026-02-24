import { ModeToggle } from "@crikket/ui/components/mode-toggle"
import { DocsLayout } from "fumadocs-ui/layouts/docs"
import { baseOptions } from "@/lib/layout.shared"
import { source } from "@/lib/source"

export default function Layout({ children }: LayoutProps<"/docs">) {
  return (
    <DocsLayout
      themeSwitch={{
        enabled: true,
        component: (
          <div className="ms-auto flex items-center">
            <ModeToggle />
          </div>
        ),
      }}
      tree={source.getPageTree()}
      {...baseOptions()}
    >
      {children}
    </DocsLayout>
  )
}
