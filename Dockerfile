# syntax=docker/dockerfile:1

# The build runs on the build machine's own architecture: its output is plain
# JavaScript with every dependency bundled in, so an arm64 laptop builds an
# amd64 image without emulation.
FROM --platform=$BUILDPLATFORM node:24-trixie-slim AS build
RUN corepack enable
WORKDIR /src
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY . .
# The path the page is mounted under, if not the root. The router and the
# asset URLs are compiled with it.
ARG BASE_PATH=
RUN BASE_PATH="$BASE_PATH" pnpm build

FROM gcr.io/distroless/nodejs24-debian13:nonroot
WORKDIR /app
COPY --from=build /src/.output ./
EXPOSE 8080
ENTRYPOINT ["/nodejs/bin/node", "/app/main.mjs"]
