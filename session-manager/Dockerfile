FROM rust:1.100.0-bookworm AS build
WORKDIR /work
COPY Cargo.toml Cargo.lock ./
COPY src src
RUN cargo build --release --locked
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /work/target/release/aegisgate-session-manager /usr/local/bin/session-manager
COPY config.json ./config.json
USER 1001
EXPOSE 8081 8082
ENTRYPOINT ["session-manager"]
