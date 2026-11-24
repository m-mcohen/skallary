// src/ui/shell/AppSidebar.tsx
//
// The persistent navigation that replaces the four modes.
//
// Items are real <a href="#/..."> anchors rather than buttons on purpose: they
// can be middle-clicked, opened in a new tab, and copied as links, and screen
// readers announce them as navigation. onClick calls navigate() anyway so the
// no-duplicate-history guard in router.ts applies.
//
// Open/closed state, its cookie, and the Ctrl/Cmd+B shortcut all come free
// from SidebarProvider in components/ui/sidebar.tsx.
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";

import { GROUP_LABELS, NAV, type NavGroup, type NavItem } from "./nav";
import { formatRoute, navigate } from "./router";

/**
 * SidebarProvider writes `sidebar_state` on every toggle but, with no SSR to
 * read it back, cannot seed itself. AppShell passes this in as defaultOpen.
 */
export function readSidebarCookie(): boolean {
  if (typeof document === "undefined") return true;
  const match = document.cookie.match(/(?:^|;\s*)sidebar_state=(true|false)/);
  return match ? match[1] === "true" : true;
}

/** Groups in first-occurrence order, so NAV alone controls layout. */
function groupOrder(): NavGroup[] {
  const seen: NavGroup[] = [];
  for (const item of NAV) if (!seen.includes(item.group)) seen.push(item.group);
  return seen;
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const href = formatRoute({ section: item.id, tab: null });
  const Icon = item.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        render={
          <a
            href={href}
            // Native title rather than SidebarMenuButton's `tooltip` prop.
            // That prop wraps the button in a Base UI TooltipTrigger, and the
            // tooltip positioner fights the sidebar's collapse/expand width
            // transition until the renderer locks up -- reproducible by
            // clicking the sidebar toggle, and invisible to jsdom because it
            // needs real layout. The label is already in the DOM for screen
            // readers (the <span> below is only hidden visually in icon
            // mode), so this hint is for sighted users alone and `title`
            // covers it with no JS at all.
            title={item.label}
            aria-current={active ? "page" : undefined}
            onClick={(e) => {
              // Let the browser handle modified clicks (new tab, new window).
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              navigate({ section: item.id, tab: null });
            }}
          />
        }
      >
        <Icon />
        <span>{item.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export default function AppSidebar({ activeSection }: { activeSection: string }) {
  const groups = groupOrder();

  return (
    // The shadcn Sidebar is position:fixed from the top of the viewport, so
    // without this offset it slides UNDER the header and summary bar and
    // covers their left end. --header-height is set by AppShell and covers
    // both bars together.
    <Sidebar
      collapsible="icon"
      className="top-(--header-height) h-[calc(100svh-var(--header-height))]! group-data-[side=left]:border-r-0"
    >
      <SidebarHeader className="px-3 py-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          <img src="/favicon.svg" alt="" className="size-6 shrink-0 scheme-light dark:scheme-dark" />
          <span className="truncate">Skallary</span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group, i) => {
          const label = GROUP_LABELS[group];
          return (
            <SidebarGroup key={group}>
              {/* The ungrouped tail (Notes, Settings) gets a rule instead of a
                  heading -- they are neither record, plan, nor model. */}
              {label ? (
                <SidebarGroupLabel>{label}</SidebarGroupLabel>
              ) : (
                i > 0 && <SidebarSeparator className="mb-1" />
              )}
              <SidebarMenu>
                {NAV.filter((item) => item.group === group).map((item) => (
                  <NavLink key={item.id} item={item} active={item.id === activeSection} />
                ))}
              </SidebarMenu>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
    </Sidebar>
  );
}
