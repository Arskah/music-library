use std::{error::Error, time::Duration};

use deadpool_postgres::{Manager, Object, Pool};
use tokio_postgres::NoTls;

const MIGRATION: &str = include_str!("../migrations/001_init.sql");
const CATALOGUE: &str = include_str!("../migrations/catalogue.sql");
/// Arbitrary; only has to be the same in every replica that starts at once,
/// and in `build_catalogue()`.
const MIGRATION_LOCK: i64 = 505_001;

/// No TLS: the connection is expected to stay inside the cluster.
pub fn connect(url: &str) -> Result<Pool, Box<dyn Error>> {
    let config: tokio_postgres::Config = url.parse()?;
    Ok(Pool::builder(Manager::new(config, NoTls))
        .max_size(8)
        .build()?)
}

/// Applies the schema, waiting for a Postgres that is still starting, and
/// gives the role `web` the password the page will connect with. Needs a role
/// that may create roles and extensions.
pub async fn migrate(pool: &Pool, web_password: &str) -> Result<(), Box<dyn Error>> {
    let mut attempt = 0;
    let mut client = loop {
        match pool.get().await {
            Ok(client) => break client,
            Err(e) if attempt < 30 => {
                attempt += 1;
                tracing::warn!("database not reachable yet ({e}), retrying");
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
            Err(e) => return Err(e.into()),
        }
    };

    let tx = client.transaction().await?;
    tx.execute("SELECT pg_advisory_xact_lock($1)", &[&MIGRATION_LOCK])
        .await?;
    tx.batch_execute(MIGRATION).await?;
    tx.batch_execute(CATALOGUE).await?;
    // ALTER ROLE takes no parameters, so the server quotes the password.
    let alter: String = tx
        .query_one(
            "SELECT format('ALTER ROLE web PASSWORD %L', $1::text)",
            &[&web_password],
        )
        .await?
        .get(0);
    tx.batch_execute(&alter).await?;
    tx.commit().await?;

    // Rebuilt even when it is there, for a view whose definition has changed.
    let rows: bool = client
        .query_one("SELECT to_regclass('hub_rows') IS NOT NULL", &[])
        .await?
        .get(0);
    if rows {
        client.execute("SELECT build_catalogue()", &[]).await?;
    } else {
        tracing::info!("no hub_rows yet: the library is empty until an owner publishes");
    }
    Ok(())
}

/// Whether there is a catalogue to query, building it over `hub_rows` the
/// first time that table is there. `web` cannot build it itself:
/// `build_catalogue()` runs as the role that applied the schema.
///
/// Asked on every request rather than remembered: the owner creates
/// `hub_rows` whenever it first connects, which may be long after this starts.
pub async fn catalogue(client: &Object) -> Result<bool, tokio_postgres::Error> {
    let row = client
        .query_one(
            "SELECT to_regclass('hub_catalogue') IS NOT NULL, to_regclass('hub_rows') IS NOT NULL",
            &[],
        )
        .await?;
    let (view, rows): (bool, bool) = (row.get(0), row.get(1));
    if view {
        return Ok(true);
    }
    if !rows {
        return Ok(false);
    }
    client.execute("SELECT build_catalogue()", &[]).await?;
    Ok(true)
}
