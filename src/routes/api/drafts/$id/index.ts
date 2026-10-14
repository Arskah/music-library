import { createFileRoute } from "@tanstack/react-router";

import { draftInput } from "../../../../schema.ts";
import { get, remove, update } from "../../../../server/drafts.server.ts";
import { apiErrors } from "../../../../errors.ts";
import { body } from "../../../../server/http.server.ts";

export const Route = createFileRoute("/api/drafts/$id/")({
  server: {
    middleware: [apiErrors],
    handlers: {
      GET: async ({ params }) => Response.json(await get(params.id)),
      PUT: async ({ params, request }) =>
        Response.json(await update(params.id, await body(request, draftInput))),
      DELETE: async ({ params }) => {
        await remove(params.id);
        return new Response(null, { status: 204 });
      },
    },
  },
});
