// src/ui/help/HelpArticle.tsx -- renders one help article. Shared by the
// slide-in panel (HelpPanel) and the Help section (HelpSection) so a screen's
// help reads the same wherever it is opened. Pure view over src/help data.
import { findTerm, termShown } from "../../help/glossary";
import type { HelpScreen } from "../../help/types";

const EYEBROW = "text-[10px] uppercase tracking-wider text-muted-foreground";

export default function HelpArticle({ screen }: { screen: HelpScreen }) {
  const terms = screen.termIds.filter(termShown).map((id) => findTerm(id)).filter((t) => t !== undefined);
  return (
    <article className="flex flex-col gap-5 text-sm" aria-label={`Help for ${screen.title}`}>
      <section>
        <h3 className={EYEBROW}>What this screen answers</h3>
        <p className="mt-1">{screen.purpose}</p>
      </section>

      {terms.length > 0 && (
        <section>
          <h3 className={EYEBROW}>Key terms</h3>
          <dl className="mt-1 flex flex-col gap-2">
            {terms.map((t) => (
              <div key={t.id}>
                <dt className="font-medium">{t.term}</dt>
                <dd className="text-muted-foreground">{t.definition}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {screen.numbers && screen.numbers.length > 0 && (
        <section>
          <h3 className={EYEBROW}>The numbers on this screen</h3>
          <dl className="mt-1 flex flex-col gap-3">
            {screen.numbers.map((n) => (
              <div key={n.label}>
                <dt className="font-medium">{n.label}</dt>
                <dd className="text-muted-foreground">{n.meaning}</dd>
                <dd className="mt-0.5">
                  <span className="text-muted-foreground">How it is worked out: </span>
                  {n.how}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {screen.howTo && screen.howTo.length > 0 && (
        <section>
          <h3 className={EYEBROW}>How to</h3>
          <div className="mt-1 flex flex-col gap-3">
            {screen.howTo.map((h) => (
              <div key={h.title}>
                <h4 className="font-medium">{h.title}</h4>
                <ol className="mt-1 list-decimal pl-5 text-muted-foreground">
                  {h.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </section>
      )}

      {screen.dataFrom && (
        <section>
          <h3 className={EYEBROW}>Where the data comes from</h3>
          <p className="mt-1 text-muted-foreground">{screen.dataFrom}</p>
        </section>
      )}

      {screen.limits && screen.limits.length > 0 && (
        <section>
          <h3 className={EYEBROW}>Limits worth knowing</h3>
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">
            {screen.limits.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
