import { createFileRoute } from "@tanstack/react-router";

import { create, list } from "../../../server/drafts.ts";
import { api, json } from "../../../server/errors.ts";

export const Route = createFileRoute("/api/drafts/")({
  server: {
    handlers: {
      GET: () => api(async () => Response.json(await list())),
      POST: ({ request }) =>
        api(async () => Response.json(await create(await json(request)), { status: 201 })),
    },
  },
});

