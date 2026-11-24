import * as React from "react"

import { ChevronDownIcon } from "lucide-react"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

// Folding cards (ui-look, after Monarch): a Card given a `foldId` gets a chevron in
// its header, folds its CardContent away, and remembers the choice in this
// browser under "ff.fold.<foldId>". A Card without one is unchanged.
const FoldContext = React.createContext<{ open: boolean; setOpen: (open: boolean) => void; name: string | null } | null>(null)

function readFold(id: string): boolean {
  try {
    return window.localStorage.getItem(`ff.fold.${id}`) !== "0"
  } catch {
    return true
  }
}

function Card({
  className,
  size = "default",
  foldId,
  children,
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm"; foldId?: string }) {
  const [open, setOpenState] = React.useState(() => (foldId ? readFold(foldId) : true))
  const setOpen = React.useCallback(
    (next: boolean) => {
      setOpenState(next)
      try {
        if (foldId) window.localStorage.setItem(`ff.fold.${foldId}`, next ? "1" : "0")
      } catch {
        // Storage refused (private window): the fold still works for this visit.
      }
    },
    [foldId]
  )
  return (
    <div
      data-slot="card"
      data-size={size}
      data-folded={foldId && !open ? "" : undefined}
      className={cn(
        "group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl bg-card py-(--card-spacing) text-sm text-card-foreground shadow-card ring-1 ring-card-ring [--card-spacing:var(--section-gap)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
        className
      )}
      {...props}
    >
      {foldId ? (
        <FoldContext.Provider value={{ open, setOpen, name: typeof props["aria-label"] === "string" ? props["aria-label"] : null }}>
          <Collapsible open={open} onOpenChange={setOpen} className="contents">
            {children}
          </Collapsible>
        </FoldContext.Provider>
      ) : (
        children
      )}
    </div>
  )
}

/** A click on the header folds the card, unless it lands on one of the header's own controls. */
function isControl(target: EventTarget | null, header: HTMLElement): boolean {
  const el = target instanceof Element ? target.closest("button, a, input, select, textarea, [role=combobox], [role=button]") : null
  return el !== null && header.contains(el)
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  const fold = React.useContext(FoldContext)
  const header = (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)",
        fold ? "min-w-0 flex-1" : "px-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
  if (!fold) return header
  return (
    <div
      data-slot="card-fold-row"
      className="flex cursor-pointer items-start gap-2 px-(--card-spacing)"
      onClick={(e) => {
        if (!isControl(e.target, e.currentTarget)) fold.setOpen(!fold.open)
      }}
    >
      <CollapsibleTrigger
        className="-ml-1 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <ChevronDownIcon aria-hidden className={cn("size-4 transition-transform motion-reduce:transition-none", !fold.open && "-rotate-90")} />
        {/* Words, not an aria-label, so lists of labelled cards stay a list of cards. */}
        <span className="sr-only">{`${fold.open ? "Fold" : "Open"} ${fold.name ?? "this card"}`}</span>
      </CollapsibleTrigger>
      {header}
    </div>
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  const fold = React.useContext(FoldContext)
  const content = (
    <div
      data-slot="card-content"
      className={cn("px-(--card-spacing)", className)}
      {...props}
    />
  )
  return fold ? <CollapsibleContent>{content}</CollapsibleContent> : content
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-xl border-t bg-muted/50 p-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
