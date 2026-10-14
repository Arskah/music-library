import { createFileRoute } from "@tanstack/react-router";

import { api, notFound } from "../../server/errors.ts";
import { receive, secret } from "../../server/webhook.ts";

// Outside the login (src/start.ts): the signature vouches for the app.
export const Route = createFileRoute("/api/webhook")({
  server: {
    handlers: {
      POST: ({ request }) =>
        api(async () => {
          const key = secret();
          if (key === null) throw notFound();
          return receive(key, request);
        }),
    },
  },
});
