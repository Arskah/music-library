import { createFileRoute } from "@tanstack/react-router";

import { file } from "../../../../server/drafts.server.ts";
import { apiErrors } from "../../../../errors.ts";

export const Route = createFileRoute("/api/drafts/$id/file")({
  server: {
    middleware: [apiErrors],
    handlers: {
      GET: ({ params }) => file(params.id),
    },
  },
});
