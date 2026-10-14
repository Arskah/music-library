import { useQuery } from "@tanstack/react-query";

import { time } from "../format.ts";
import { nowPlayingQuery } from "../queries.ts";

/** How long past its end a track is still believed: the app sends no
 * `stopped` when it crashes. */
const ON_AIR_GRACE = 60_000;

export function OnAir() {
  const { data, dataUpdatedAt, isError } = useQuery(nowPlayingQuery());
  const event = isError ? null : data?.event;
  if (event?.event !== "now_playing") return null;

  const { track } = event;
  const started = Date.parse(event.startedAt);
  if (!(dataUpdatedAt < started + track.durationSec * 1000 + ON_AIR_GRACE)) return null;

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
