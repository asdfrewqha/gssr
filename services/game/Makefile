.PHONY: build build-arm build-amd64 test test-coverage docker-build

build:
	go build ./...

build-amd64:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
	  go build -trimpath -ldflags="-s -w" -o dist/game-server-amd64 ./cmd/server

build-arm:
	CGO_ENABLED=0 GOOS=linux GOARCH=arm GOARM=7 \
	  go build -trimpath -ldflags="-s -w" -o dist/game-server-arm ./cmd/server

test:
	go test ./... -race -v

test-coverage:
	go test ./... -race -coverprofile=coverage.out
	go tool cover -func=coverage.out
	@go tool cover -func=coverage.out | grep total | awk '{if ($$3+0 < 80) {print "Coverage below 80%: " $$3; exit 1}}'

docker-build:
	docker buildx build \
	  --platform linux/amd64,linux/arm/v7 \
	  -t $(DOCKERHUB_USERNAME)/gssr-game:dev \
	  .
