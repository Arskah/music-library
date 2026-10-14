import { z } from "zod";

import { badRequest, unprocessable } from "../errors.ts";

/** The request's body read against `schema`: a 400 for a body that is not
 * JSON, a 422 for one of the wrong shape. */
export async function body<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw badRequest("the body is not JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw unprocessable(z.prettifyError(parsed.error));
  return parsed.data;
}
