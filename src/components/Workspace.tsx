import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useLocation } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import type { z } from "zod";

import { time } from "../format.ts";
import { saveDraft } from "../functions.ts";
import { draftQuery, draftsQuery } from "../queries.ts";
import { draftInput, type Draft, type Entry } from "../schema.ts";
import { DraftList } from "./DraftList.tsx";
import { Library } from "./Library.tsx";

const route = getRouteApi("/");

/** An entry with a key of its own: the same track can be in a draft twice. */
type Row = { key: string; entry: Entry };
const row = (entry: Entry): Row => ({ key: crypto.randomUUID(), entry });

/** The library and the draft being put together, which starts from `draft`,
 * or empty. */
export function Workspace(props: {
  draft: Draft | null;
  author: string;
  onAuthor: (author: string) => void;
}) {
  const navigate = route.useNavigate();
  const queryClient = useQueryClient();
  const arrivedSaved = useLocation({ select: (l) => l.state.saved === true });

  const id = props.draft?.id;
  const [name, setName] = useState(props.draft?.name ?? "");
  const [author, setAuthor] = useState(props.draft?.author ?? props.author);
  const [rows, setRows] = useState(() => (props.draft?.entries ?? []).map(row));
  const [edited, setEdited] = useState(false);

  const saveFn = useServerFn(saveDraft);
  const save = useMutation({
    // Checked here first against the server's own schema, which says what is
    // wrong where the server's check would only refuse it.
    mutationFn: ({ id, ...draft }: { id?: string } & z.input<typeof draftInput>) => {
      const parsed = draftInput.safeParse(draft);
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      return saveFn({ data: { id, ...parsed.data } });
    },
    onSuccess: async (saved) => {
      queryClient.setQueryData(draftQuery(saved.id).queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: draftsQuery().queryKey, exact: true });
      if (saved.id === id) {
        setName(saved.name);
        setAuthor(saved.author);
      } else {
        await navigate({ search: (s) => ({ ...s, draft: saved.id }), state: { saved: true } });
      }
    },
  });

  // An edit makes the last save's outcome stale.
  const edit = () => {
    setEdited(true);
    save.reset();
  };
  const editRows = (next: Row[]) => {
    setRows(next);
    edit();
  };

  const onNew = () => {
    if (id) {
      navigate({ search: (s) => ({ ...s, draft: undefined }) });
    } else {
      setName("");
      setRows([]);
      edit();
    }
  };

  const move = (from: number, to: number) => {
    const next = [...rows];
    next.splice(to, 0, ...next.splice(from, 1));
    editRows(next);
  };

  const total = rows.reduce((sum, { entry }) => sum + (entry.duration ?? 0), 0);
  const saved = save.isSuccess || (arrivedSaved && !edited);

  return (
    <main>
      <Library onAdd={(entry) => editRows([...rows, row(entry)])} />

      <div>
        <section>
          <h2>{id ? "Draft" : "New draft"}</h2>
          <div className="row">
            <input
              placeholder="Name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                edit();
              }}
            />
            <input
              placeholder="Your name"
              value={author}
              onChange={(e) => {
                setAuthor(e.target.value);
                props.onAuthor(e.target.value);
                edit();
              }}
            />
          </div>
          <div className="row">
            <button
              disabled={save.isPending}
              onClick={() => save.mutate({ id, name, author, entries: rows.map((r) => r.entry) })}
            >
              Save draft
            </button>
            {id ? (
              <a className="button" href={`${import.meta.env.BASE_URL}api/drafts/${id}/file`} download>
                Download file
              </a>
            ) : (
              <button disabled>Download file</button>
            )}
            <button onClick={onNew}>New</button>
          </div>
          {save.error ? (
            <p className="note error">{save.error.message}</p>
          ) : (
            <p className="note">{`${rows.length} entries, ${time(total)}${saved ? " — saved" : ""}`}</p>
          )}
          <div className="scroll">
            <table>
              <tbody>
                {rows.map(({ key, entry }, i) => (
                  <tr key={key}>
                    <td className="num">{i + 1}</td>
                    <td>{entry.title}</td>
                    <td>{entry.artist}</td>
                    <td className="num">{time(entry.duration)}</td>
                    <td>
                      <button disabled={i === 0} onClick={() => move(i, i - 1)}>
                        ↑
                      </button>{" "}
                      <button disabled={i === rows.length - 1} onClick={() => move(i, i + 1)}>
                        ↓
                      </button>{" "}
                      <button onClick={() => editRows(rows.filter((r) => r.key !== key))}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <DraftList />
      </div>
    </main>
  );
}
