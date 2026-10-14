import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { searchInput } from "../../schema.ts";
import { apiErrors, badRequest } from "../../errors.ts";
import { search } from "../../server/search.server.ts";

export const Route = createFileRoute("/api/search")({
  server: {
    middleware: [apiErrors],
    handlers: {
      GET: async ({ request }) => {
        const params = new URL(request.url).searchParams;
        const input = searchInput.safeParse({
          q: params.get("q") ?? undefined,
          type: params.get("type") || undefined,
        });
        if (!input.success) throw badRequest(z.prettifyError(input.error));
        return Response.json(await search(input.data));
      },
    },
  },
});
