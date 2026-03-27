# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM golang:1.24-alpine AS builder

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
FROM alpine:3.20
RUN apk add --no-cache ca-certificates wget
COPY --from=builder /out/game-server /game-server

EXPOSE 3000
ENTRYPOINT ["/game-server"]
