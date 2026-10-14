import { createFileRoute } from "@tanstack/react-router";

import { api } from "../../server/errors.ts";
import { search } from "../../server/search.ts";

export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      GET: ({ request }) =>
        api(async () => {
          const params = new URL(request.url).searchParams;
          return Response.json(await search(params.get("q") ?? "", params.get("type")));
        }),
    },
  },
});
