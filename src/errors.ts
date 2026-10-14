import { createMiddleware } from "@tanstack/react-start";
import { z } from "zod";

// Isomorphic: `start.ts` registers the middleware for the page's bundle
// too, where Start strips what runs on the server.
//
// An error the API answers with is a Response, `{ "error": message }`, for
// the code to throw. Start sends a thrown Response as it is, and hands one
// thrown in a server function to the page that called it.
const error = (status: number, message: string) => Response.json({ error: message }, { status });

export const badRequest = (message: string) => error(400, message);
export const unauthorized = () => error(401, "unauthorized");
export const notFound = () => error(404, "not found");
export const tooLarge = () => error(413, "body too large");
export const unprocessable = (message: string) => error(422, message);

/** A thrown Response as it is, a schema's refusal as a 422, and anything
 * else, logged, as `otherwise()`: no Postgres message reaches the page. */
function settle(e: unknown, otherwise: () => unknown): unknown {
  if (e instanceof Response) return e;
  if (e instanceof z.ZodError) return unprocessable(z.prettifyError(e));
  console.error(e);
  return otherwise();
}

/** For the API's server routes: a bare 500. */
export const apiErrors = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (e) {
    throw settle(e, () => error(500, "internal error"));
  }
});

/** For every server function: an Error, which a loader's error component
 * shows, where a Response thrown during rendering would end the page. */
export const functionErrors = createMiddleware({ type: "function" }).server(async ({ next }) => {
  try {
    return await next();
  } catch (e) {
    throw settle(e, () => new Error("internal error"));
  }
});
