import { createStart } from "@tanstack/react-start";

import { functionErrors } from "./errors.ts";

// The login is not here but in front of the whole server (`main.ts`), where
// it also covers the page's scripts, which Nitro serves before Start sees a
// request.
export const startInstance = createStart(() => ({
  functionMiddleware: [functionErrors],
}));
