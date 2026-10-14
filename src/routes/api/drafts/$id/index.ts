import { createFileRoute } from "@tanstack/react-router";

import { get, remove, update } from "../../../../server/drafts.ts";
import { api, json } from "../../../../server/errors.ts";

export const Route = createFileRoute("/api/drafts/$id/")({
  server: {
    handlers: {
      GET: ({ params }) => api(async () => Response.json(await get(params.id))),
      PUT: ({ params, request }) =>
        api(async () => Response.json(await update(params.id, await json(request)))),
      DELETE: ({ params }) =>
        api(async () => {
          await remove(params.id);
          return new Response(null, { status: 204 });
        }),
    },
  },
});
