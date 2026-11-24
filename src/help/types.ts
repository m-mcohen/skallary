// src/help/types.ts -- the shape of the in-app help.
//
// Help is plain data so that three surfaces can share one set of words: the
// slide-in panel behind the "?" in the header, the info points beside the
// confusing numbers, and the Help section in the sidebar. A term is defined
// once, in glossary.ts, and only referenced from here.
//
// The user's choices for this pass: full depth on the number-heavy screens and
// short everywhere else; static text (no live figures); the user is the only reader;
// drafted from what the code computes, for the user to edit. The user's edits to the words
// are canonical -- change the code's behavior and the matching article together.

export type HelpDepth = "short" | "full";

/** One word or label, defined once and reused everywhere it appears. */
export interface HelpTerm {
  id: string;
  /** As it reads on screen, e.g. "Drawable". */
  term: string;
  definition: string;
}

/** A number on the screen: what it means and how to check it by hand. */
export interface HelpNumber {
  /** The on-screen label, verbatim. */
  label: string;
  meaning: string;
  /** The formula in words. */
  how: string;
}

export interface HelpHowTo {
  title: string;
  steps: string[];
}

export interface HelpScreen {
  /** "runway", or "budget.charts" for a tab. See helpKey(). */
  key: string;
  title: string;
  depth: HelpDepth;
  /** The question this screen answers. */
  purpose: string;
  /**
   * The "This page answers" line shown at the top of the screen itself: one plain sentence, edited here so the on-screen
   * line and the Help article stay in step. Required for every real screen;
   * getting-started has none, because it is not a screen you land on.
   */
  answers?: string;
  /** Glossary ids: the key terms for this screen. */
  termIds: string[];
  // Full depth only:
  numbers?: HelpNumber[];
  howTo?: HelpHowTo[];
  dataFrom?: string;
  limits?: string[];
}
