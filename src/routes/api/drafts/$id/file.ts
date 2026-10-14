import { createFileRoute } from "@tanstack/react-router";

import { file } from "../../../../server/drafts.ts";
import { api } from "../../../../server/errors.ts";

export const Route = createFileRoute("/api/drafts/$id/file")({
  server: {
    handlers: {
      GET: ({ params }) => api(() => file(params.id)),
    },
  },
});
