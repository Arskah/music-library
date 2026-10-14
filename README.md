# library-search

A test build of the web page backend that RadiodioDJ's shared-library design
describes: it searches the station's catalogue in the Postgres hub, keeps
drafts, and hands a draft out as the saved playlist file the app imports.

It is a test setup, not part of RadiodioDJ, and it runs ahead of the design in
one respect. The design gives the page a catalogue table of its own that the
owner publishes (increment W1), and no build does that yet. So the page reads
what the owner does publish: `hub_catalogue` here is a view over the `track`
documents in `hub_rows` (`migrations/catalogue.sql`). What follows from that:

- **The page depends on the track document's key names**, which are the app's
  `tracks` column names. Renaming one there empties a field here.
- **A hidden track is still listed.** Hiding is not in the track document and
  travels as a group of its own that nothing publishes yet.
- **The library is empty until an owner has connected.** `hub_rows` is the
  owner's to create; the view and its indexes are built the first time a
  request finds the table there.

A track with no fingerprint yet, a missing track and a purged one are left
out.

There are no logins of its own. `BASIC_AUTH`, as `user:password`, puts one
shared HTTP basic-auth login in front of the page and its API, and is all that
stands between the internet and the drafts: everyone who has it can read,
change and delete every one of them. Unset, the page is open.

## What it does

| route                       |                                                             |
| --------------------------- | ----------------------------------------------------------- |
| `GET /`                     | the page                                                    |
| `GET /api/search?q=&type=`  | up to 200 present tracks; `type` is a content type          |
|                             | `published` is false until the hub has its tables           |
| `GET /api/drafts`           | every draft, newest first                                   |
| `POST /api/drafts`          | a new draft: `name`, `author`, `entries`                    |
| `GET/PUT/DELETE /api/drafts/{id}` | one draft                                             |
| `GET /api/drafts/{id}/file` | the draft as a `radiodiodj-playlist` file                   |
| `POST /api/webhook`         | the app's now-playing webhook; signed, not behind the login |
| `GET /api/now-playing`      | the last `now_playing` or `stopped` event, `null` before one |

Search is the app's: every word must match the start of a word in the title,
artist, album, album artist or genre, in any order, with accents folded. When
that finds fewer than ten tracks a second pass adds near matches by trigram
similarity, marked `loose` and listed after the exact ones. That pass is
Postgres' and will not rank as the app's planned edit-distance pass does.

A draft entry's fingerprint has to be in the catalogue, or already in the
draft being saved.

`BASE_PATH` mounts the page and its API below a path, for a host shared with
something else. It is read when the image is built, not when it runs: the
router and the asset URLs are compiled with it
(`docker build --build-arg BASE_PATH=/library`). A request outside the path
is redirected into it.

### The now-playing webhook

`WEBHOOK_SECRET` turns on `POST /api/webhook`, for RadiodioDJ's now-playing
broadcast (its `docs/now-playing-broadcast.md`). Set the same value as the
webhook secret in the app, and <https://music.aarnihalinen.fi/api/webhook> as
its URL. Unset, neither route is there.

The app cannot answer the login, so the endpoint is outside it. What it asks
for instead is `X-RadiodioDJ-Signature: sha256=<hex>`, the HMAC-SHA256 of the
body under the secret: `401` without a valid one, `400` for a body that is not
one of the app's events, `204` otherwise. The signature covers the body and
nothing else, so a captured request can be sent again; the worst that does is
put an old track back as the current one.

The last `now_playing` or `stopped` is kept in memory, without the track's
`id` and `path`, and `GET /api/now-playing` hands it back behind the login. A
restart forgets it. A `test` event is checked and logged, not kept. The page
asks every ten seconds and shows the track above the library while it is on:
until a `stopped`, or a minute past the track's own length. The app
sends no `stopped` when it crashes, so a reader has to judge by `startedAt`
and `durationSec` whether the track is still on.

## Run it locally

```sh
docker compose up --build
```

The page is at <http://127.0.0.1:8080>, over a throwaway Postgres that
`dev/hub-sample.sql` fills as an owner would, with made-up tracks. Their
fingerprints match no audio file, so a playlist file from a local run imports
into the app with every entry unmatched. `docker compose down -v` removes it.

It is a [TanStack Start](https://tanstack.com/start) app on Node. The page,
`src/routes/index.tsx`, keeps its search and the open draft in its URL and
reads and writes through the server functions in `src/functions.ts`; the API
is the server routes under `src/routes/api`. Both call `src/server`, whose
`*.server.ts` files the page's bundle is refused, and share the shapes in
`src/schema.ts`. `main.ts` is the image's entrypoint, which
either applies the schema (`migrate`) or serves the handler Nitro builds,
with the login in front of all of it, the page's scripts and styles included.
The toolchain comes from [mise](https://mise.jdx.dev) and pnpm from corepack:

```sh
mise install
pnpm install
pnpm test && pnpm typecheck
pnpm build
DATABASE_URL=postgres://web:web@127.0.0.1:5432/library pnpm start
```

`pnpm dev` serves the page with hot reload; it needs `DATABASE_URL` too, and
asks for no login whatever `BASIC_AUTH` says, since the login is `main.ts`'s.

## Deploy to the cluster

Everything lands in the `music-library` namespace: Postgres as a one-replica
StatefulSet on the default storage class, the backend, and a route that serves
the page at <https://music.aarnihalinen.fi> through the cluster's shared
gateway.

ArgoCD deploys the `k8s` directory: the Application `music-library` in
[Arskah/kube](https://github.com/Arskah/kube) (`apps/templates/music-library.yml`)
syncs it from `main`. Merging a change to `k8s` is the deploy.

```sh
# Build for the cluster's architecture and push.
docker build --platform linux/amd64 -t registry.aarnihalinen.fi/library-search:0.5.0 --push .
```

### Secrets

Five secrets in the namespace are not in this repository. They are SealedSecrets
in Arskah/kube (`sealed-secrets/sealed-music-library-*.json`):

- `admin-password`, key `password`: the password of `admin`, the database's superuser.
  Postgres reads it only when it first creates the database, so changing it
  later means changing it in Postgres too.
- `web-db`, key `password`: the password of `web`, the role the page connects
  as. The `migrate` init container sets it on every start, so changing the
  secret and restarting the page is enough. It goes into a URL as it is, so
  letters and digits only.
- `web-login`, key `login`: the page's shared login, as `user:password`.
- `web-webhook`, key `secret`: what the app signs its now-playing events with.
  Optional: without it the page starts with no webhook endpoint.
- `regcred`: the pull secret for `registry.aarnihalinen.fi`.

A new image needs a new tag in `k8s/kustomization.yaml`.

### The gateway's side

The gateway `gateway/public` is not managed from here. For the route in
`k8s/gateway.yaml` to attach, it needs this listener, and the hostname needs a
DNS record:

```yaml
- name: music
  hostname: music.aarnihalinen.fi
  port: 443
  protocol: HTTPS
  allowedRoutes:
    namespaces:
      from: Selector
      selector:
        matchLabels:
          kubernetes.io/metadata.name: music-library
  tls:
    certificateRefs:
      - name: tls-secret
        namespace: music-library
```

The certificate is cert-manager's to issue once the name resolves.

### Filling the library

Nothing is seeded. Point a RadiodioDJ owner at the hub. From outside the
cluster that is the role `hub_owner`, over TLS, on the port the router forwards
to `postgres-external` (node port 30432 on the worker node):

```sh
echo "postgres://hub_owner:<password>@music.aarnihalinen.fi:<port>/library"
```

No `sslmode`: the app always asks for TLS and checks the certificate against
the hostname, and its URL parser knows no `verify-full`. `psql` does, and
should be given it, with the authorities to check against: it does not look
in the system's on its own. `sslrootcert=system` from libpq 16 on, and before
that the bundle's path, `/etc/ssl/cert.pem` on a Mac:

```sh
psql "postgres://hub_owner:<password>@music.aarnihalinen.fi:<port>/library?sslmode=verify-full&sslrootcert=system"
```

The role is not created by anything here. Once, as `admin`:

```sql
CREATE ROLE hub_owner LOGIN PASSWORD '<password>';
GRANT CREATE ON SCHEMA public TO hub_owner;
-- Only if an owner has already published as `admin`:
ALTER TABLE hub_rows OWNER TO hub_owner;
```

A studio connects the same way as the role `studio`, which every studio
machine shares: the hub tells them apart by machine id. It moves rows and can
change no table, which matters because the address sits in the machine's
`config.json` with its password. Once, as `admin`, after an owner has
published:

```sql
CREATE ROLE studio LOGIN PASSWORD '<password>';
GRANT SELECT, UPDATE ON hub_station TO studio;
GRANT SELECT, INSERT, UPDATE ON hub_machines TO studio;
GRANT SELECT, INSERT, UPDATE ON hub_rows TO studio;
GRANT USAGE ON SEQUENCE hub_rev TO studio;
-- For the tables an owner makes again after a reset:
ALTER DEFAULT PRIVILEGES FOR ROLE hub_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO studio;
ALTER DEFAULT PRIVILEGES FOR ROLE hub_owner IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO studio;
```

Nothing in Postgres keeps a studio from writing a track: that only the owner
publishes the library is the app's rule.

`k8s/postgres.yaml` holds the `pg_hba.conf` that keeps `admin`, a superuser,
inside the cluster. Postgres serves the page's certificate, so the hostname is
the page's. From a machine with access to the cluster, `admin` still works
through a port-forward; the certificate does not match `127.0.0.1`, so the URL
can ask for at most `sslmode=require`:

```sh
kubectl -n music-library port-forward svc/postgres 5432:5432
echo "postgres://admin:$(cut -d= -f2 k8s/secret.env)@127.0.0.1:5432/library"
```

The view over `hub_rows` stops a plain `DROP TABLE hub_rows`; a reset is
`DROP TABLE hub_rows CASCADE`, and the view comes back with the next request.

### Taking it down

To take the page off the internet and keep the rest, delete the route:
`kubectl -n music-library delete httproute web`. It is then reachable with
`kubectl -n music-library port-forward svc/web 8080:80`.

To remove it all, `kubectl delete namespace music-library`. The storage class
keeps a deleted volume's data, so the database's directory stays on the NFS
share until it is removed there.
