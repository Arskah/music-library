// Where the page is mounted when an ingress serves it below a path it shares
// with something else, e.g. `/library`. Empty means the root. Read when the
// page is built: the router, the asset URLs and the entrypoint's exemption for
// the webhook are compiled with it.
export const base = (process.env.BASE_PATH ?? "").replace(/\/+$/, "");
if (base !== "" && !base.startsWith("/")) {
  throw new Error("BASE_PATH must start with /");
}
