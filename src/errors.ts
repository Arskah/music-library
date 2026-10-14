import { createMiddleware } from "@tanstack/react-start";
import { z } from "zod";

// Isomorphic: `start.ts` registers the middleware for the page's bundle
// too, where Start strips what runs on the server.
//
// An error the API answers with is a Response, `{ "error": message }`, for
// the code to throw. Start sends one thrown in a server route as it is.
const error = (status: number, message: string) => Response.json({ error: message }, { status });

export const badRequest = (message: string) => error(400, message);
export const unauthorized = () => error(401, "unauthorized");
export const notFound = () => error(404, "not found");
export const tooLarge = () => error(413, "body too large");
export const unprocessable = (message: string) => error(422, message);

/** What a thrown error answers with: a Response as it is, a schema's refusal
 * as a 422, and anything else, logged, as a bare 500, so no Postgres message
 * reaches the page. */
function answer(e: unknown): Response {
  if (e instanceof Response) return e;
  if (e instanceof z.ZodError) return unprocessable(z.prettifyError(e));
  console.error(e);
  return error(500, "internal error");
}

/** For the API's server routes. */
export const apiErrors = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (e) {
    throw answer(e);
  }
});

/** For every server function: the answer's message as an Error, which Start
 * hands to the page that called it, or to a loader's error component. */
export const functionErrors = createMiddleware({ type: "function" }).server(async ({ next }) => {
  try {
    return await next();
  } catch (e) {
    const { error } = await answer(e).json();
    throw new Error(error);
  }
});
