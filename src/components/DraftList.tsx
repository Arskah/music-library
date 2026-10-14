import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { deleteDraft } from "../functions.ts";
import { draftQuery, draftsQuery } from "../queries.ts";

const route = getRouteApi("/");

export function DraftList() {
  const { data: drafts } = useSuspenseQuery(draftsQuery());
  const { draft: open } = route.useSearch();
  const navigate = route.useNavigate();
  const queryClient = useQueryClient();
  const deleteFn = useServerFn(deleteDraft);
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: async (_, id) => {
      if (id === open) await navigate({ search: (s) => ({ ...s, draft: undefined }) });
      queryClient.removeQueries({ queryKey: draftQuery(id).queryKey });
      await queryClient.invalidateQueries({ queryKey: draftsQuery().queryKey });
    },
  });

  return (
    <section className="drafts">
      <h2>Drafts</h2>
      {remove.error && <p className="note error">{remove.error.message}</p>}
      <ul>
        {drafts.length === 0 && <li className="note">No drafts yet.</li>}
        {drafts.map((d) => (
          <li key={d.id}>
            <span>{`${d.name} — ${d.author}, ${d.entryCount} entries, ${d.updatedAt}`}</span>
            <Link className="button" to="/" search={(s) => ({ ...s, draft: d.id })}>
              Open
            </Link>
            <button
              disabled={remove.isPending}
              onClick={() => {
                if (confirm(`Delete the draft "${d.name}"?`)) remove.mutate(d.id);
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
