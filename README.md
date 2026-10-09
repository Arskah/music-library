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

Search is the app's: every word must match the start of a word in the title,
artist, album, album artist or genre, in any order, with accents folded. When
that finds fewer than ten tracks a second pass adds near matches by trigram
similarity, marked `loose` and listed after the exact ones. That pass is
Postgres' and will not rank as the app's planned edit-distance pass does.

A draft entry's fingerprint has to be in the catalogue, or already in the
draft being saved.

`BASE_PATH` mounts the page and its API below a path, for a host shared with
something else.

## Run it locally

```sh
docker compose up --build
```

The page is at <http://127.0.0.1:8080>, over a throwaway Postgres that
`dev/hub-sample.sql` fills as an owner would, with made-up tracks. Their
fingerprints match no audio file, so a playlist file from a local run imports
into the app with every entry unmatched. `docker compose down -v` removes it.

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
docker build --platform linux/amd64 -t registry.aarnihalinen.fi/library-search:0.3.1 --push .
```

### Secrets

Three secrets in the namespace are not in this repository. They are SealedSecrets
in Arskah/kube (`sealed-secrets/sealed-music-library-*.json`):

- `hub`, key `password`: the database password. Postgres reads it only when it
  first creates the database, so changing it later means changing it in Postgres
  too.
- `web-login`, key `login`: the page's shared login, as `user:password`.
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

Nothing is seeded. Point a RadiodioDJ owner at the hub, from a machine with
access to the cluster:

```sh
kubectl -n music-library port-forward svc/postgres 5432:5432
echo "postgres://library:$(cut -d= -f2 k8s/secret.env)@127.0.0.1:5432/library"
```

The server has no TLS, so the URL must not ask for it with `sslmode=require`.
The view over `hub_rows` stops a plain `DROP TABLE hub_rows`; a reset is
`DROP TABLE hub_rows CASCADE`, and the view comes back with the next request.

### Taking it down

To take the page off the internet and keep the rest, delete the route:
`kubectl -n music-library delete httproute web`. It is then reachable with
`kubectl -n music-library port-forward svc/web 8080:80`.

To remove it all, `kubectl delete namespace music-library`. The storage class
keeps a deleted volume's data, so the database's directory stays on the NFS
share until it is removed there.
