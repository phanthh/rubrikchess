# --- web (wasm + vite) ---
FROM rust:1-bookworm AS web
RUN rustup target add wasm32-unknown-unknown \
 && curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs \
 && npm i -g pnpm@8
WORKDIR /src
COPY . .
RUN pnpm build:wasm && pnpm install --frozen-lockfile && pnpm --filter @rubrikchess/web build

# --- server ---
FROM rust:1-bookworm AS server
WORKDIR /src
COPY . .
RUN cargo build --release -p rubrik-server

# --- runtime ---
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=server /src/target/release/rubrik-server /app/rubrik-server
COPY --from=web /src/apps/web/dist /app/web
# SECURE_COOKIES=1 assumes TLS termination in front of this container.
ENV PORT=3000 WEB_DIST=/app/web DATABASE_PATH=/data/rubrik.db SECURE_COOKIES=1
VOLUME /data
EXPOSE 3000
CMD ["/app/rubrik-server"]
