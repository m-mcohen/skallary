// src/ui/help/PageAnswers.tsx -- the "This page answers" line. One sentence at the top of every screen,
// from the same help data the "?" panel and the Help section read (the
// `answers` field, src/help/screens/*), so editing it once changes it
// everywhere. The switch on Settings, Guide hides every line at once; it
// never renders inside Help itself, because the article there already opens
// with the same words under "What this screen answers" (HelpArticle.tsx).
import { helpFor } from "../../help";
import { useShowGuideLines } from "../lib/guide-visibility";

export interface PageAnswersProps {
  sectionId: string;
  tabId: string | null;
}

export default function PageAnswers({ sectionId, tabId }: PageAnswersProps) {
  const show = useShowGuideLines();
  // helpFor("help", tabId) always resolves to getting-started, which itself
  // carries no answers line, so this guard is belt-and-braces today -- but
  // it is the one line that keeps that true if getting-started ever gains
  // one, so it is checked directly (see the mocked-helpFor test).
  if (sectionId === "help" || !show) return null;
  const answers = helpFor(sectionId, tabId)?.answers;
  if (!answers) return null;
  return <p className="text-sm text-muted-foreground">This page answers: {answers}</p>;
}
