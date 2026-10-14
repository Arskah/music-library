import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Draft, DraftSummary, Entry } from "../server/drafts.ts";
import type { Results } from "../server/search.ts";
import type { Event } from "../server/webhook.ts";

export const Route = createFileRoute("/")({
  headers: () => ({ "cache-control": "no-cache" }),
  component: Page,
});

// The path the page is mounted under, with its trailing slash.
const BASE = import.meta.env.BASE_URL;

// How often the page asks what is on air, and how long past its end a track
// is still believed: the app sends no `stopped` when it crashes.
const ON_AIR_EVERY = 10_000;
const ON_AIR_GRACE = 60_000;

function time(seconds: number | null | undefined): string {
  if (seconds == null) return "";
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(BASE + path, {
    method: options.method,
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (response.status === 204) return null as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? response.statusText);
  return body;
}

type Working = { id: string | null; name: string; author: string; entries: Entry[] };
type Note = { text: string; error: boolean };

function Page() {
  const [draft, setDraft] = useState<Working>({ id: null, name: "", author: "", entries: [] });
  const [saved, setSaved] = useState<Note | null>(null);
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);

  const edit = (change: Partial<Working>) => {
    setDraft((d) => ({ ...d, ...change }));
    setSaved(null);
  };

  const loadDrafts = useCallback(async () => {
    setDrafts(await api<DraftSummary[]>("api/drafts"));
  }, []);
  useEffect(() => {
    loadDrafts();
  }, [loadDrafts]);

  const show = (d: Draft) => {
    setDraft({ id: d.id, name: d.name, author: d.author, entries: d.entries });
    setSaved(null);
  };

  const clear = () => edit({ id: null, name: "", entries: [] });

  const save = async () => {
    const body = { name: draft.name, author: draft.author, entries: draft.entries };
    try {
      show(
        draft.id
          ? await api<Draft>(`api/drafts/${draft.id}`, { method: "PUT", body })
          : await api<Draft>("api/drafts", { method: "POST", body }),
      );
      setSaved({ text: " — saved", error: false });
      loadDrafts();
    } catch (e) {
      setSaved({ text: (e as Error).message, error: true });
    }
  };

  const remove = async (d: DraftSummary) => {
    if (!confirm(`Delete the draft "${d.name}"?`)) return;
    await api(`api/drafts/${d.id}`, { method: "DELETE" });
    if (draft.id === d.id) clear();
    loadDrafts();
  };

  const move = (from: number, to: number) => {
    const entries = [...draft.entries];
    entries.splice(to, 0, ...entries.splice(from, 1));
    edit({ entries });
  };

  const total = draft.entries.reduce((sum, e) => sum + (e.duration ?? 0), 0);
  const summary = `${draft.entries.length} entries, ${time(total)}`;

  return (
    <>
      <OnAir />
      <main>
        <Library onAdd={(entry) => edit({ entries: [...draft.entries, entry] })} />

        <div>
          <section>
            <h2>{draft.id ? "Draft" : "New draft"}</h2>
            <div className="row">
              <input placeholder="Name" value={draft.name} onChange={(e) => edit({ name: e.target.value })} />
              <input
                placeholder="Your name"
                value={draft.author}
                onChange={(e) => edit({ author: e.target.value })}
              />
            </div>
            <div className="row">
              <button onClick={save}>Save draft</button>
              <button
                disabled={!draft.id}
                onClick={() => {
                  location.href = `${BASE}api/drafts/${draft.id}/file`;
                }}
              >
                Download file
              </button>
              <button onClick={clear}>New</button>
            </div>
            <p className={saved?.error ? "note error" : "note"}>
              {saved?.error ? saved.text : summary + (saved?.text ?? "")}
            </p>
            <div className="scroll">
              <table>
                <tbody>
                  {draft.entries.map((entry, i) => (
                    <tr key={`${i}:${entry.fingerprint}`}>
                      <td className="num">{i + 1}</td>
                      <td>{entry.title}</td>
                      <td>{entry.artist}</td>
                      <td className="num">{time(entry.duration)}</td>
                      <td>
                        <button disabled={i === 0} onClick={() => move(i, i - 1)}>
                          ↑
                        </button>{" "}
                        <button disabled={i === draft.entries.length - 1} onClick={() => move(i, i + 1)}>
                          ↓
                        </button>{" "}
                        <button onClick={() => edit({ entries: draft.entries.filter((_, j) => j !== i) })}>
                          ×
                        </button>
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
              {drafts?.length === 0 && <li className="note">No drafts yet.</li>}
              {drafts?.map((d) => (
                <li key={d.id}>
                  <span>{`${d.name} — ${d.author}, ${d.entryCount} entries, ${d.updatedAt}`}</span>
                  <button onClick={async () => show(await api<Draft>(`api/drafts/${d.id}`))}>Open</button>
                  <button onClick={() => remove(d)}>Delete</button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
    </>
  );
}

function Library({ onAdd }: { onAdd: (entry: Entry) => void }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const mine = ++latest.current;
    const params = new URLSearchParams({ q, type });
    // Typing waits for a pause; the first load and a type change do not.
    const timer = setTimeout(
      async () => {
        try {
          const found = await api<Results>(`api/search?${params}`);
          if (mine !== latest.current) return;
          setResults(found);
          setError(null);
        } catch (e) {
          if (mine !== latest.current) return;
          setError((e as Error).message);
        }
      },
      mine === 1 ? 0 : 250,
    );
    return () => clearTimeout(timer);
  }, [q, type]);

  let status = "";
  if (results) {
    const loose = results.tracks.filter((t) => t.loose).length;
    status = !results.published
      ? "The library has not been published to the hub yet."
      : `${results.tracks.length} tracks` +
        (results.capped ? ", the first of more" : "") +
        (loose ? `; ${loose} in italics are near matches` : "");
  }

  return (
    <section>
      <h2>Library</h2>
      <div className="row">
        <input
          type="search"
          placeholder="Title, artist, album, album artist, genre"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          <option value="music">Music</option>
          <option value="jingle">Jingles</option>
          <option value="commercial">Commercials</option>
        </select>
      </div>
      <p className={error ? "note error" : "note"}>{error ?? status}</p>
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
            {results?.tracks.map((t) => (
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
  const [event, setEvent] = useState<Event | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const ask = async () => {
      try {
        const response = await fetch(`${BASE}api/now-playing`);
        // No webhook on this server: there will never be anything to show.
        if (response.status === 404) return;
        if (response.ok) setEvent(await response.json());
        else setEvent(null);
      } catch {
        // Unreachable for now; ask again.
        setEvent(null);
      }
      setNow(Date.now());
      if (!stopped) timer = setTimeout(ask, ON_AIR_EVERY);
    };
    ask();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

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
