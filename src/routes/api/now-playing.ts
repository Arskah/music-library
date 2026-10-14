import { createFileRoute } from "@tanstack/react-router";

import { api, notFound } from "../../server/errors.ts";
import { nowPlaying, secret } from "../../server/webhook.ts";

export const Route = createFileRoute("/api/now-playing")({
  server: {
    handlers: {
      GET: () =>
        api(async () => {
          // No webhook, so nothing will ever be playing: the page stops asking.
          if (secret() === null) throw notFound();
          return Response.json(nowPlaying());
        }),
    },
  },
});
