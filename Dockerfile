# syntax=docker/dockerfile:1

# The compiler runs on the build machine's own architecture and cross-compiles
# to the target's, so an arm64 laptop builds an amd64 image without emulation.
# Every dependency is pure Rust, which is what lets rust-lld link it alone.
FROM --platform=$BUILDPLATFORM rust:1.99-bookworm AS build
ARG TARGETARCH
RUN case "$TARGETARCH" in \
      amd64) echo x86_64-unknown-linux-musl ;; \
      arm64) echo aarch64-unknown-linux-musl ;; \
      *) echo "unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac > /rust-target \
 && rustup target add "$(cat /rust-target)"
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY migrations ./migrations
COPY web ./web
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target,sharing=locked \
    RUSTFLAGS="-C linker=rust-lld" \
    cargo build --release --locked --target "$(cat /rust-target)" \
 && cp "target/$(cat /rust-target)/release/library-search" /library-search

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /library-search /library-search
EXPOSE 8080
ENTRYPOINT ["/library-search"]
