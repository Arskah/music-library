// The image's entrypoint. `migrate` applies the schema, as a role that may
// change it; anything else serves the page, which connects as `web` and may
// not.
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { CHALLENGE, expected, same } from "./src/server/auth.server.ts";
import { connect, migrate } from "./src/server/db.server.ts";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

const sql = (name: string) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), "utf8");

// The app cannot answer the login, and the signature is what vouches for it.
const WEBHOOK = `${import.meta.env.BASE_URL}api/webhook`;

/** How long requests still running get to finish once asked to stop. */
const DRAIN_MS = 5000;

if (process.argv[2] === "migrate") {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const password = process.env.WEB_PASSWORD;
  if (!password) throw new Error("WEB_PASSWORD is not set");
  const db = connect(url);
  try {
    await migrate(db, password, { migration: sql("001_init.sql"), catalogue: sql("catalogue.sql") });
  } finally {
    await db.end();
  }
} else {
  await serve();
}

async function serve() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!process.env.WEBHOOK_SECRET?.trim()) {
    console.info("WEBHOOK_SECRET is not set: no webhook endpoint");
  }

  // A path, not a module specifier, so the bundle leaves it to run time.
  const app: { middleware: Handler } = await import(
    new URL("./server/index.mjs", import.meta.url).href
  );

  // One shared login, `user:password`, for a gateway that cannot ask for one
  // itself. The page has no logins of its own. It stands in front of
  // everything Nitro serves, the page's own scripts included.
  const want = expected();
  if (want === null) console.warn("BASIC_AUTH is not set: the page and every draft are open");
  const server = createServer((req, res) => {
    const path = req.url?.split("?", 1)[0];
    const given = req.headers.authorization;
    if (want === null || path === WEBHOOK || (given !== undefined && same(given, want))) {
      app.middleware(req, res);
      return;
    }
    res.writeHead(401, { "www-authenticate": CHALLENGE, "content-length": 0 }).end();
  });

  const [host, port] = (process.env.LISTEN_ADDR ?? "0.0.0.0:8080").split(/:(?=\d+$)/);
  server.listen(Number(port), host, () => console.info(`listening on ${host}:${port}`));

  // Stops taking requests and lets the running ones finish. The process ends
  // once they have: the pool's idle connections do not hold it open.
  const stop = () => {
    server.close();
    server.closeIdleConnections();
    setTimeout(() => server.closeAllConnections(), DRAIN_MS).unref();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
