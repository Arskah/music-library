import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { time } from "../format.ts";
import { tracksQuery } from "../queries.ts";
import { contentType, type Entry } from "../schema.ts";

const route = getRouteApi("/");

/** Typing waits for a pause before it searches. */
const TYPING_PAUSE = 250;

export function Library({ onAdd }: { onAdd: (entry: Entry) => void }) {
  const { q, type } = route.useSearch();
  const navigate = route.useNavigate();
  const { data: results } = useSuspenseQuery(tracksQuery({ q, type }));
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
                        contentType: contentType.safeParse(t.contentType).data ?? null,
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
