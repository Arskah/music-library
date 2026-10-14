import { createFileRoute } from "@tanstack/react-router";

import { apiErrors, notFound } from "../../errors.ts";
import { receive, secret } from "../../server/webhook.server.ts";

// Outside the login (`main.ts`): the signature vouches for the app.
export const Route = createFileRoute("/api/webhook")({
  server: {
    middleware: [apiErrors],
    handlers: {
      POST: ({ request }) => {
        const key = secret();
        if (key === null) throw notFound();
        return receive(key, request);
      },
    },
  },
});
