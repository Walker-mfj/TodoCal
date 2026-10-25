FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /api ./cmd/api

FROM alpine:3.23
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 app
COPY --from=build /api /usr/local/bin/todocal-api
COPY start.sh /usr/local/bin/start-api
USER app
EXPOSE 10000
ENTRYPOINT ["sh", "/usr/local/bin/start-api"]
