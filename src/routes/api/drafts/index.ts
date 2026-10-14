import { createFileRoute } from "@tanstack/react-router";

import { draftInput } from "../../../schema.ts";
import { create, list } from "../../../server/drafts.server.ts";
import { apiErrors } from "../../../errors.ts";
import { body } from "../../../server/http.server.ts";

export const Route = createFileRoute("/api/drafts/")({
  server: {
    middleware: [apiErrors],
    handlers: {
      GET: async () => Response.json(await list()),
      POST: async ({ request }) =>
        Response.json(await create(await body(request, draftInput)), { status: 201 }),
    },
  },
});
