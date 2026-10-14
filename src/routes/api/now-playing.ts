import { createFileRoute } from "@tanstack/react-router";

import { apiErrors, notFound } from "../../errors.ts";
import { nowPlaying, secret } from "../../server/webhook.server.ts";

export const Route = createFileRoute("/api/now-playing")({
  server: {
    middleware: [apiErrors],
    handlers: {
      GET: () => {
        if (secret() === null) throw notFound();
        return Response.json(nowPlaying());
      },
    },
  },
});
