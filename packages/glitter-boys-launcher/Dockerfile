# syntax=docker/dockerfile:1-labs@sha256:36366b12c1dffb228bb25e9feffb73707b93388f084f4927d2b7686dba29e76a
FROM rust:1.99.1-bookworm@sha256:e6f2cff35d0f309acf8433b4f05878ed77092602c5065cc81801177da0bb3a9c AS builder
WORKDIR /src
# The build context is this package (docker-bake.hcl target glitter-boys-launcher).
COPY . ./
RUN cargo build --release --locked --package glitter-boys-service

FROM debian:trixie-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2 AS runtime
COPY --from=builder /src/target/release/glitter-boys-service /usr/local/bin/glitter-boys-service
COPY --from=builder /etc/ssl/certs/ /etc/ssl/certs/
USER 1000:1000
EXPOSE 8080 9091
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"
CMD ["/usr/local/bin/glitter-boys-service"]

FROM runtime AS smoke
RUN /usr/local/bin/glitter-boys-service --smoke

FROM runtime AS image
