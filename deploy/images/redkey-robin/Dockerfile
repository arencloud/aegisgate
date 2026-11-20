# syntax=docker/dockerfile:1.7
FROM --platform=$BUILDPLATFORM golang:1.26.5-trixie AS build
WORKDIR /src
RUN git clone https://github.com/InditexTech/redkey-operator.git redkey-operator \
    && git -C redkey-operator checkout f8bd1ede32fdb8115873a639d2418c934fa3ffb5 \
    && git clone https://github.com/InditexTech/redkey-robin.git redkey-robin \
    && git -C redkey-robin checkout 74c42cee884e418a2b2b0ee95981e8a97a83e481
WORKDIR /src/redkey-robin
COPY ipv6-standalone.patch /tmp/ipv6-standalone.patch
RUN git apply --check /tmp/ipv6-standalone.patch && git apply /tmp/ipv6-standalone.patch
RUN --mount=type=cache,target=/go/pkg/mod go mod download
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go test ./internal/kubernetes ./internal/metrics \
    && go test ./internal/reconciler -run TestStandalone
ARG TARGETOS
ARG TARGETARCH
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build \
    -ldflags='-X main.version=0.2.0-aegisgate-ipv6.1' -o /out/robin ./cmd/

# Preserve upstream runtime utilities, redis-cli, and non-root configuration.
FROM ghcr.io/inditextech/redkey-robin:0.2.0@sha256:d174bab6d680e834dbc04e3c48a7ac8a7adab3b6aef4e8e88e8b387ec175f4e2
COPY --from=build /out/robin /robin
LABEL org.opencontainers.image.title="AegisGate Robin standalone IPv6 compatibility"
LABEL org.opencontainers.image.version="0.2.0-aegisgate-ipv6.1"
