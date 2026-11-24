// src/ui/help/HelpSection.tsx -- the Help section in the sidebar: the same articles the "?" panel shows, laid out as a manual you
// can read start to finish, plus the glossary. The list follows the sidebar's
// own order and groups (Record, Plan, Model) so finding a screen's article
// works the way finding the screen does.
//
// The selected article is the second route segment (#/help/budget.charts).
// Plain anchors, like the tab strip, for the reason AppShell records: a
// controlled control that writes the URL while the URL writes it back fights
// the Back button.
import { GROUP_LABELS, NAV, SUB_PAGES, type NavGroup } from "../shell/nav";
import { GETTING_STARTED_KEY, HELP_SCREENS, helpByKey, helpKey } from "../../help";
import { GLOSSARY, termShown } from "../../help/glossary";
import HelpArticle from "./HelpArticle";

const GLOSSARY_KEY = "glossary";
const EYEBROW = "text-[10px] uppercase tracking-wider text-muted-foreground";

interface Entry {
  key: string;
  label: string;
}

function entriesByGroup(): { group: NavGroup; label: string | null; entries: Entry[] }[] {
  const groups: NavGroup[] = [];
  for (const item of NAV) if (item.id !== "help" && !groups.includes(item.group)) groups.push(item.group);
  return groups.map((group) => ({
    group,
    label: GROUP_LABELS[group],
    entries: NAV.filter((i) => i.group === group && i.id !== "help").flatMap((i) => [
      ...(i.tabs && i.tabs.length > 0
        ? i.tabs.map((t) => ({ key: helpKey(i.id, t.id), label: `${i.label}: ${t.label}` }))
        : [{ key: helpKey(i.id, null), label: i.label }]),
      // A page under a screen follows its screen.
      ...SUB_PAGES.filter((p) => p.section === i.id).map((p) => ({ key: helpKey(p.section, p.page), label: `${i.label}: ${p.label}` })),
    ]),
  }));
}

function HelpLink({ entry, selected }: { entry: Entry; selected: boolean }) {
  return (
    <a
      href={`#/help/${encodeURIComponent(entry.key)}`}
      aria-current={selected ? "page" : undefined}
      className={
        "rounded-md px-2 py-1 text-sm " +
        (selected ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")
      }
    >
      {entry.label}
    </a>
  );
}

export default function HelpSection({ selectedKey }: { selectedKey: string | null }) {
  const isGlossary = selectedKey === GLOSSARY_KEY;
  // An unknown or missing key opens on getting started rather than a blank body.
  // Old bookmarks to the articles that moved still open the right one.
  const MOVED: Record<string, string> = { "budget.yearly": "recurring.yearly", recurring: "recurring.charges" };
  const key = selectedKey ? MOVED[selectedKey] ?? selectedKey : "";
  const screen = isGlossary ? null : helpByKey(key) ?? helpByKey(GETTING_STARTED_KEY);
  const activeKey = isGlossary ? GLOSSARY_KEY : screen?.key ?? null;
  const glossary = GLOSSARY.filter((t) => termShown(t.id)).sort((a, b) => a.term.localeCompare(b.term));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
      {/* On a phone the article comes first and the list of articles follows
          it; from lg up the list is the left column. One nav, reordered with
          CSS, so there is a single landmark either way. */}
      <nav aria-label="Help articles" className="order-2 flex flex-col gap-3 lg:order-1">
        <div className="flex flex-col">
          <HelpLink entry={{ key: GETTING_STARTED_KEY, label: "Getting started" }} selected={activeKey === GETTING_STARTED_KEY} />
        </div>
        {entriesByGroup().map(({ group, label, entries }) => (
          <div key={group} className="flex flex-col">
            {label && <div className={`${EYEBROW} px-2 pb-1`}>{label}</div>}
            {entries.map((e) => (
              <HelpLink key={e.key} entry={e} selected={activeKey === e.key} />
            ))}
          </div>
        ))}
        <div className="flex flex-col">
          <HelpLink entry={{ key: GLOSSARY_KEY, label: "Glossary" }} selected={isGlossary} />
        </div>
      </nav>

      <div className="order-1 min-w-0 max-w-2xl lg:order-2">
        {isGlossary ? (
          <section aria-label="Glossary" className="flex flex-col gap-4">
            <div>
              <h2 className="font-heading text-base font-semibold">Glossary</h2>
              <p className="text-sm text-muted-foreground">Every term the help uses, defined once. {glossary.length} terms.</p>
            </div>
            <dl className="flex flex-col gap-3 text-sm">
              {glossary.map((t) => (
                <div key={t.id}>
                  <dt className="font-medium">{t.term}</dt>
                  <dd className="text-muted-foreground">{t.definition}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : screen ? (
          <div className="flex flex-col gap-4">
            <h2 className="font-heading text-base font-semibold">{screen.title}</h2>
            <HelpArticle screen={screen} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No help has been written yet. {HELP_SCREENS.length} articles found.</p>
        )}
      </div>
    </div>
  );
}
