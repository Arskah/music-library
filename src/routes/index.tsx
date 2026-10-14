import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { OnAir } from "../components/OnAir.tsx";
import { Workspace } from "../components/Workspace.tsx";
import { draftQuery, draftsQuery, tracksQuery } from "../queries.ts";
import { contentType, draftId } from "../schema.ts";

// What the page shows is in its URL: the search, and the draft that is open.
// A value that makes no sense there is dropped rather than refused.
const pageSearch = z.object({
  q: z.string().optional().catch(undefined),
  type: contentType.optional().catch(undefined),
  draft: draftId.optional().catch(undefined),
});

export const Route = createFileRoute("/")({
  validateSearch: pageSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ context: { queryClient }, deps: { q, type, draft } }) =>
    Promise.all([
      queryClient.ensureQueryData(tracksQuery({ q, type })),
      queryClient.ensureQueryData(draftsQuery()),
      queryClient.ensureQueryData(draftQuery(draft)),
    ]),
  headers: () => ({ "cache-control": "no-cache" }),
  errorComponent: Failed,
  component: Page,
});

function Page() {
  const { draft: id } = Route.useSearch();
  const { data: draft } = useSuspenseQuery(draftQuery(id));
  // "Your name" outlives the draft it was typed into.
  const [author, setAuthor] = useState("");

  return (
    <>
      <OnAir />
      <Workspace key={draft?.id ?? "new"} draft={draft} author={author} onAuthor={setAuthor} />
    </>
  );
}

function Failed({ error }: ErrorComponentProps) {
  return (
    <main>
      <section>
        <p className="note error">{error instanceof Error ? error.message : String(error)}</p>
      </section>
    </main>
  );
}
