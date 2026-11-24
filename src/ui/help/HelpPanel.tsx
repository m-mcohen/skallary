// src/ui/help/HelpPanel.tsx -- the "?" in the header.
//
// Opens a slide-in panel with the help for the screen you are on, so the
// explanation sits beside the numbers instead of replacing them. The words
// come from src/help; the same article renders in the Help section.
//
// Registries-first: the panel is the
// installed @shadcn/sheet. @shadcnblocks has a "help menu" dropdown block
// (links out to docs and support), which is not this: the help here is the
// content itself, written for this app's screens.
import { useRef, useState } from "react";
import { CircleHelpIcon } from "lucide-react";

import { helpFor } from "../../help";
import HelpArticle from "./HelpArticle";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export interface HelpPanelProps {
  sectionId: string;
  tabId: string | null;
}

export default function HelpPanel({ sectionId, tabId }: HelpPanelProps) {
  const [open, setOpen] = useState(false);
  // Focus starts on the title. Left to itself the panel focuses its first
  // focusable element, which is the link at the END of the article (the close
  // button renders after the content), and the panel opens scrolled to the
  // bottom. Seen in a real browser; jsdom does not scroll.
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const screen = helpFor(sectionId, tabId);

  return (
    // Non-modal on purpose: help is for
    // reading WHILE you use the screen. A modal panel blurred the numbers it
    // was explaining and swallowed the first click outside it. So: no focus
    // trap, no scroll lock, no dismissal on an outside click. It closes on
    // the X, on Escape, or by pressing Help again, and because the article is
    // looked up from the route on every render, it follows you between screens.
    <Sheet open={open} onOpenChange={setOpen} modal={false} disablePointerDismissal>
      <SheetTrigger render={<Button variant="outline" size="sm" aria-label="Help for this screen" data-testid="help-trigger" />}>
        <CircleHelpIcon className="size-3.5" />
        {/* Icon only on a phone, where the header has no room for the word.
            The button keeps its full name for screen readers either way. */}
        <span className="hidden sm:inline">Help</span>
      </SheetTrigger>
      {/* No backdrop at all: a full-screen layer, even a clear one, would sit
          over the page and block every click on it. */}
      <SheetContent
        side="right"
        initialFocus={titleRef}
        overlayClassName="hidden"
        className="overflow-y-auto data-[side=right]:sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle ref={titleRef} tabIndex={-1} className="outline-hidden">
            {screen ? `Help: ${screen.title}` : "Help"}
          </SheetTitle>
          <SheetDescription>What this screen shows and how its numbers are worked out.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          {screen ? (
            <>
              <HelpArticle screen={screen} />
              <a
                href={`#/help/${encodeURIComponent(screen.key)}`}
                className="mt-6 inline-block text-sm text-primary underline-offset-4 hover:underline"
                onClick={() => setOpen(false)}
              >
                Open this in the Help section
              </a>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No help has been written for this screen yet.</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
