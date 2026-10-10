# syntax=docker/dockerfile:1-labs@sha256:63e440b412b6acba117974e793b7e7f702e58ee65e044bdff1b8d388ee0d853b
FROM rust:1.98.1-bookworm@sha256:93ce27a88655056a51dbdd8f5f2d7ddc071c7b0070fb288a37b5a285fc83971e AS builder
WORKDIR /src
COPY packages/glitter-boys-launcher/ ./
RUN cargo build --release --locked --package glitter-boys-service

FROM debian:trixie-slim@sha256:a99cfc517144bc59b1978475ec53b46ecabec7e43635402ee5b77cc54cd1b20a AS runtime
COPY --from=builder /src/target/release/glitter-boys-service /usr/local/bin/glitter-boys-service
COPY --from=builder /etc/ssl/certs/ /etc/ssl/certs/
USER 1000:1000
EXPOSE 8080 9091
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"
CMD ["/usr/local/bin/glitter-boys-service"]

FROM runtime AS smoke
RUN /usr/local/bin/glitter-boys-service --smoke

FROM runtime AS image
