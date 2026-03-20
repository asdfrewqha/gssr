# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM golang:1.22-alpine AS builder

ARG TARGETARCH
ARG TARGETARM

WORKDIR /src

# Use vendor/ directory — no network access needed inside Docker.
# One-time setup on host: cd services/game && go mod vendor
COPY go.mod go.sum ./
COPY vendor/ vendor/
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} GOARM=${TARGETARM} \
    go build -mod=vendor -trimpath -ldflags="-s -w" -o /out/game-server ./cmd/server

# --- Final image ---
FROM scratch
COPY --from=builder /out/game-server /game-server
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

EXPOSE 3000 2112
ENTRYPOINT ["/game-server"]
