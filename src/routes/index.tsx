import { createFileRoute, Link, useNavigate, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import { deleteDraft, findDraft, getNowPlaying, listDrafts, saveDraft, searchTracks } from "../functions.ts";
import { contentType, type Draft, type DraftSummary, type Entry, type Event, type Results } from "../schema.ts";

// What the page shows is in its URL: the search, and the draft that is open.
// A value that makes no sense there is dropped rather than refused.
const pageSearch = z.object({
  q: z.string().optional().catch(undefined),
  type: contentType.optional().catch(undefined),
  draft: z.uuid().optional().catch(undefined),
});

export const Route = createFileRoute("/")({
  validateSearch: pageSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps: { q, type, draft } }) => {
    const [results, drafts, open] = await Promise.all([
      searchTracks({ data: { q, type } }),
      listDrafts(),
      draft ? findDraft({ data: { id: draft } }) : null,
    ]);
    return { results, drafts, draft: open };
  },
  headers: () => ({ "cache-control": "no-cache" }),
  errorComponent: Failed,
  component: Page,
});

// The path the page is mounted under, with its trailing slash.
const BASE = import.meta.env.BASE_URL;

// How often the page asks what is on air, and how long past its end a track
// is still believed: the app sends no `stopped` when it crashes.
const ON_AIR_EVERY = 10_000;
const ON_AIR_GRACE = 60_000;

/** Typing waits for a pause before it searches. */
const TYPING_PAUSE = 250;

function time(seconds: number | null | undefined): string {
  if (seconds == null) return "";
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** What went wrong, from an error a server function threw: the API's own
 * `{ "error": message }` when it answered with one. */
async function message(e: unknown): Promise<string> {
  if (e instanceof Response) {
    const body = await e.json().catch(() => null);
    return body?.error ?? e.statusText;
  }
  return e instanceof Error ? e.message : String(e);
}

function Failed({ error }: ErrorComponentProps) {
  // A Response's body can only be read later, so it fills in once read.
  const [text, setText] = useState(error instanceof Error ? error.message : "");
  useEffect(() => {
    if (error instanceof Response) message(error).then(setText);
  }, [error]);
  return (
    <main>
      <section>
        <p className="note error">{text}</p>
      </section>
    </main>
  );
}

function Page() {
  const { draft } = Route.useLoaderData();
  // "Your name" outlives the draft it was typed into.
  const [author, setAuthor] = useState("");
  // Bumped by "New" on a new draft, to start it again.
  const [fresh, setFresh] = useState(0);
  // A new draft is shown afresh once saved, as the one open in the URL; this
  // carries its "saved" over. Leaving it for another draft drops it.
  const [justSaved, setJustSaved] = useState<string | null>(null);

  return (
    <>
      <OnAir />
      <Workspace
        key={`${draft?.id ?? "new"}#${fresh}`}
        loaded={draft}
        author={author}
        onAuthor={setAuthor}
        saved={draft !== null && draft.id === justSaved}
        onSaved={setJustSaved}
        onLeave={() => setJustSaved(null)}
        onNew={() => setFresh((n) => n + 1)}
      />
    </>
  );
}

type Note = { text: string; error: boolean };

/** The library and the draft being put together, which starts from the draft
 * open in the URL, or empty. */
function Workspace(props: {
  loaded: Draft | null;
  author: string;
  onAuthor: (author: string) => void;
  saved: boolean;
  onSaved: (id: string) => void;
  onLeave: () => void;
  onNew: () => void;
}) {
  const { results, drafts } = Route.useLoaderData();
  const navigate = useNavigate({ from: Route.fullPath });
  const router = useRouter();
  const save = useServerFn(saveDraft);
  const remove = useServerFn(deleteDraft);

  const [id, setId] = useState(props.loaded?.id);
  const [name, setName] = useState(props.loaded?.name ?? "");
  const [author, setAuthor] = useState(props.loaded?.author ?? props.author);
  const [entries, setEntries] = useState<Entry[]>(props.loaded?.entries ?? []);
  const [note, setNote] = useState<Note | null>(props.saved ? { text: " — saved", error: false } : null);

  // An edit makes the last save's note stale.
  const editEntries = (next: Entry[]) => {
    setEntries(next);
    setNote(null);
  };

  const onSave = async () => {
    try {
      const saved = await save({ data: { id, name, author, entries } });
      setId(saved.id);
      setName(saved.name);
      setAuthor(saved.author);
      setEntries(saved.entries);
      setNote({ text: " — saved", error: false });
      props.onSaved(saved.id);
      if (saved.id !== props.loaded?.id) {
        await navigate({ search: (s) => ({ ...s, draft: saved.id }) });
      }
      await router.invalidate();
    } catch (e) {
      setNote({ text: await message(e), error: true });
    }
  };

  const onDelete = async (d: DraftSummary) => {
    if (!confirm(`Delete the draft "${d.name}"?`)) return;
    try {
      await remove({ data: { id: d.id } });
    } catch (e) {
      alert(await message(e));
      return;
    }
    if (d.id === id) await navigate({ search: (s) => ({ ...s, draft: undefined }) });
    await router.invalidate();
  };

  const onNew = () => {
    props.onLeave();
    if (props.loaded) navigate({ search: (s) => ({ ...s, draft: undefined }) });
    else props.onNew();
  };

  const move = (from: number, to: number) => {
    const next = [...entries];
    next.splice(to, 0, ...next.splice(from, 1));
    editEntries(next);
  };

  const total = entries.reduce((sum, e) => sum + (e.duration ?? 0), 0);
  const summary = `${entries.length} entries, ${time(total)}`;

  return (
    <main>
      <Library results={results} onAdd={(entry) => editEntries([...entries, entry])} />

      <div>
        <section>
          <h2>{id ? "Draft" : "New draft"}</h2>
          <div className="row">
            <input
              placeholder="Name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNote(null);
              }}
            />
            <input
              placeholder="Your name"
              value={author}
              onChange={(e) => {
                setAuthor(e.target.value);
                setNote(null);
                props.onAuthor(e.target.value);
              }}
            />
          </div>
          <div className="row">
            <button onClick={onSave}>Save draft</button>
            {id ? (
              <a className="button" href={`${BASE}api/drafts/${id}/file`} download>
                Download file
              </a>
            ) : (
              <button disabled>Download file</button>
            )}
            <button onClick={onNew}>New</button>
          </div>
          <p className={note?.error ? "note error" : "note"}>
            {note?.error ? note.text : summary + (note?.text ?? "")}
          </p>
          <div className="scroll">
            <table>
              <tbody>
                {entries.map((entry, i) => (
                  <tr key={`${i}:${entry.fingerprint}`}>
                    <td className="num">{i + 1}</td>
                    <td>{entry.title}</td>
                    <td>{entry.artist}</td>
                    <td className="num">{time(entry.duration)}</td>
                    <td>
                      <button disabled={i === 0} onClick={() => move(i, i - 1)}>
                        ↑
                      </button>{" "}
                      <button disabled={i === entries.length - 1} onClick={() => move(i, i + 1)}>
                        ↓
                      </button>{" "}
                      <button onClick={() => editEntries(entries.filter((_, j) => j !== i))}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section style={{ marginTop: 16 }}>
          <h2>Drafts</h2>
          <ul>
            {drafts.length === 0 && <li className="note">No drafts yet.</li>}
            {drafts.map((d) => (
              <li key={d.id}>
                <span>{`${d.name} — ${d.author}, ${d.entryCount} entries, ${d.updatedAt}`}</span>
                <Link
                  className="button"
                  from={Route.fullPath}
                  search={(s) => ({ ...s, draft: d.id })}
                  onClick={props.onLeave}
                >
                  Open
                </Link>
                <button onClick={() => onDelete(d)}>Delete</button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}

function Library({ results, onAdd }: { results: Results; onAdd: (entry: Entry) => void }) {
  const { q, type } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [text, setText] = useState(q ?? "");
  const typing = useRef<ReturnType<typeof setTimeout>>(undefined);

  const onType = (value: string) => {
    setText(value);
    clearTimeout(typing.current);
    typing.current = setTimeout(
      () => navigate({ search: (s) => ({ ...s, q: value || undefined }), replace: true }),
      TYPING_PAUSE,
    );
  };

  const loose = results.tracks.filter((t) => t.loose).length;
  const status = !results.published
    ? "The library has not been published to the hub yet."
    : `${results.tracks.length} tracks` +
      (results.capped ? ", the first of more" : "") +
      (loose ? `; ${loose} in italics are near matches` : "");

  return (
    <section>
      <h2>Library</h2>
      <div className="row">
        <input
          type="search"
          placeholder="Title, artist, album, album artist, genre"
          autoFocus
          value={text}
          onChange={(e) => onType(e.target.value)}
        />
        <select
          value={type ?? ""}
          onChange={(e) =>
            navigate({
              search: (s) => ({ ...s, type: contentType.safeParse(e.target.value).data }),
              replace: true,
            })
          }
        >
          <option value="">All types</option>
          <option value="music">Music</option>
          <option value="jingle">Jingles</option>
          <option value="commercial">Commercials</option>
        </select>
      </div>
      <p className="note">{status}</p>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Title</th>
              <th>Artist</th>
              <th>Album</th>
              <th>Genre</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {results.tracks.map((t) => (
              <tr key={t.trackId} className={t.loose ? "loose" : ""}>
                <td>
                  <button
                    title="Add to the draft"
                    onClick={() =>
                      onAdd({
                        fingerprint: t.fingerprint,
                        artist: t.artist,
                        title: t.title,
                        duration: t.duration,
                        contentType: t.contentType,
                      })
                    }
                  >
                    +
                  </button>
                </td>
                <td>{t.title}</td>
                <td>{t.artist}</td>
                <td>{t.album}</td>
                <td>{t.genre}</td>
                <td className="num">{time(t.duration)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OnAir() {
  const ask = useServerFn(getNowPlaying);
  const [event, setEvent] = useState<Event | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const poll = async () => {
      try {
        const { enabled, event } = await ask();
        // No webhook on this server: there will never be anything to show.
        if (!enabled) return;
        setEvent(event);
      } catch {
        // Unreachable for now; ask again.
        setEvent(null);
      }
      setNow(Date.now());
      if (!stopped) timer = setTimeout(poll, ON_AIR_EVERY);
    };
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [ask]);

  if (event?.event !== "now_playing") return null;
  const { track } = event;
  const started = Date.parse(event.startedAt);
  if (!(now < started + track.durationSec * 1000 + ON_AIR_GRACE)) return null;

  const artist = track.artist.trim();
  const title = track.title.trim();
  const at = new Date(started).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <header id="on-air">
      <b>On air</b>
      <span>{artist ? `${artist} – ${title}` : title}</span>
      <span className="note">{`${time(track.durationSec)}, started ${at}`}</span>
    </header>
  );
}
