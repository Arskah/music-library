/** An error the API answers with as `{ "error": message }`. */
export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (message: string) => new ApiError(400, message);
export const unprocessable = (message: string) => new ApiError(422, message);
export const notFound = () => new ApiError(404, "not found");

/** Runs a handler, turning what it throws into the API's error body. */
export async function api(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (e) {
    if (e instanceof ApiError) {
      return Response.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}

/** The request's body as JSON, or a 400 for a body that is not. */
export async function json(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("the body is not JSON");
  }
}
