import { ChevronDownIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { version } from "../../package.json";
import { ABOUT_FAQ } from "../help/about-faq";

export default function AboutSettings() {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle><h2>Skallary</h2></CardTitle>
          <CardDescription>Version {version}</CardDescription>
        </CardHeader>
        <CardContent>
          <p>A budget that runs on your own computer. Your data stays here. Skallary uses the internet to sync with your bank link and look up public mortgage rates.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle><h2>License</h2></CardTitle>
          <CardDescription>Free software under the GNU Affero General Public License 3.0 or later. Shared as is, without support.</CardDescription>
        </CardHeader>
        <CardContent>
          <a
            href="https://github.com/m-mcohen/skallary"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4"
          >
            See the source code
          </a>
        </CardContent>
      </Card>
      {ABOUT_FAQ.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle><h2>Frequently asked questions</h2></CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {ABOUT_FAQ.map(({ question, answer, links }) => (
              <Collapsible key={question}>
                <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-md py-2 text-left font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring [&[aria-expanded=true]>svg]:rotate-180">
                  {question}
                  <ChevronDownIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </CollapsibleTrigger>
                <CollapsibleContent className="pb-3 text-muted-foreground">
                  <p>{answer}</p>
                  {links && (
                    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                      {links.map(({ label, href }) => (
                        <li key={href}>
                          <a href={href} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-4">
                            {label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </CollapsibleContent>
              </Collapsible>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
