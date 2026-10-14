import pg from "pg";

// int8 arrives as a string by default. Track ids are row keys, well inside a
// double's integers.
pg.types.setTypeParser(pg.types.builtins.INT8, Number);

/** Arbitrary; only has to be the same in every replica that starts at once,
 * and in `build_catalogue()`. */
const MIGRATION_LOCK = 505_001;

/** No TLS: the connection is expected to stay inside the cluster. Idle
 * connections do not hold the process open once the server has closed. */
export function connect(url: string): pg.Pool {
  return new pg.Pool({ connectionString: url, max: 8, allowExitOnIdle: true });
}

let shared: pg.Pool | undefined;

/** The page's pool, made on first use from `DATABASE_URL`. */
export function pool(): pg.Pool {
  if (!shared) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    shared = connect(url);
  }
  return shared;
}

/** Applies the schema, waiting for a Postgres that is still starting, and
 * gives the role `web` the password the page will connect with. Needs a role
 * that may create roles and extensions. */
export async function migrate(
  db: pg.Pool,
  webPassword: string,
  sql: { migration: string; catalogue: string },
): Promise<void> {
  let attempt = 0;
  let client: pg.PoolClient;
  for (;;) {
    try {
      client = await db.connect();
      break;
    } catch (e) {
      if (attempt >= 30) throw e;
      attempt += 1;
      console.warn(`database not reachable yet (${e}), retrying`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  try {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK]);
      await client.query(sql.migration);
      await client.query(sql.catalogue);
      // ALTER ROLE takes no parameters, so the server quotes the password.
      const { rows } = await client.query<{ alter: string }>(
        "SELECT format('ALTER ROLE web PASSWORD %L', $1::text) AS alter",
        [webPassword],
      );
      await client.query(rows[0].alter);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }

    // Rebuilt even when it is there, for a view whose definition has changed.
    const { rows } = await client.query<{ rows: boolean }>(
      "SELECT to_regclass('hub_rows') IS NOT NULL AS rows",
    );
    if (rows[0].rows) {
      await client.query("SELECT build_catalogue()");
    } else {
      console.info("no hub_rows yet: the library is empty until an owner publishes");
    }
  } finally {
    client.release();
  }
}

/** Whether there is a catalogue to query, building it over `hub_rows` the
 * first time that table is there. `web` cannot build it itself:
 * `build_catalogue()` runs as the role that applied the schema.
 *
 * Asked on every request rather than remembered: the owner creates
 * `hub_rows` whenever it first connects, which may be long after this starts. */
export async function catalogue(client: pg.PoolClient): Promise<boolean> {
  const { rows } = await client.query<{ view: boolean; rows: boolean }>(
    `SELECT to_regclass('hub_catalogue') IS NOT NULL AS view,
            to_regclass('hub_rows') IS NOT NULL AS rows`,
  );
  if (rows[0].view) return true;
  if (!rows[0].rows) return false;
  await client.query("SELECT build_catalogue()");
  return true;
}

/** Runs `work` with a client from the page's pool. */
export async function withClient<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    return await work(client);
  } finally {
    client.release();
  }
}
