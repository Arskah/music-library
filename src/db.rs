use std::{error::Error, time::Duration};

use deadpool_postgres::{Manager, Object, Pool};
use tokio_postgres::NoTls;

const MIGRATION: &str = include_str!("../migrations/001_init.sql");
const CATALOGUE: &str = include_str!("../migrations/catalogue.sql");
/// Arbitrary; only has to be the same in every replica that starts at once.
const MIGRATION_LOCK: i64 = 505_001;

/// No TLS: the connection is expected to stay inside the cluster.
pub fn connect(url: &str) -> Result<Pool, Box<dyn Error>> {
    let config: tokio_postgres::Config = url.parse()?;
    Ok(Pool::builder(Manager::new(config, NoTls))
        .max_size(8)
        .build()?)
}

/// Applies the schema, waiting for a Postgres that is still starting.
pub async fn migrate(pool: &Pool) -> Result<(), Box<dyn Error>> {
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
    tx.commit().await?;

    if !catalogue(&mut client, true).await? {
        tracing::info!("no hub_rows yet: the library is empty until an owner publishes");
    }
    Ok(())
}

/// Whether there is a catalogue to query, building it over `hub_rows` the
/// first time that table is there. `refresh` rebuilds it even when it exists.
///
/// Asked on every request rather than remembered: the owner creates
/// `hub_rows` whenever it first connects, which may be long after this starts.
pub async fn catalogue(client: &mut Object, refresh: bool) -> Result<bool, tokio_postgres::Error> {
    let row = client
        .query_one(
            "SELECT to_regclass('hub_catalogue') IS NOT NULL, to_regclass('hub_rows') IS NOT NULL",
            &[],
        )
        .await?;
    let (view, rows): (bool, bool) = (row.get(0), row.get(1));
    if view && !refresh {
        return Ok(true);
    }
    if !rows {
        return Ok(false);
    }
    let tx = client.transaction().await?;
    tx.execute("SELECT pg_advisory_xact_lock($1)", &[&MIGRATION_LOCK])
        .await?;
    tx.batch_execute(CATALOGUE).await?;
    tx.commit().await?;
    Ok(true)
}
