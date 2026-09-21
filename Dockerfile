# --- web (wasm + vite) ---
FROM node:22.22.0-bookworm-slim AS node
FROM rust:1.93.1-bookworm AS web
COPY --from=node /usr/local /usr/local
RUN npm install --global pnpm@8.15.8 \
 && cargo install wasm-pack --version 0.13.1 --locked
WORKDIR /src
COPY . .
RUN pnpm build:wasm && pnpm install --frozen-lockfile && pnpm --filter @rubrikchess/web build

# --- server ---
FROM rust:1.93.1-bookworm AS server
WORKDIR /src
COPY . .
RUN cargo build --release --locked -p rubrik-server

# --- runtime ---
FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl sqlite3 \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --create-home rubrik \
 && mkdir /data \
 && chown rubrik:rubrik /data
WORKDIR /app
COPY --from=server /src/target/release/rubrik-server /app/rubrik-server
COPY --from=web /src/apps/web/dist /app/web
COPY deploy/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod 755 /app/docker-entrypoint.sh
# SECURE_COOKIES=1 assumes TLS termination in front of this container.
ENV PORT=3000 WEB_DIST=/app/web DATABASE_PATH=/data/rubrik.db SECURE_COOKIES=1
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl --fail --silent http://127.0.0.1:3000/healthz || exit 1
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["/app/rubrik-server"]
