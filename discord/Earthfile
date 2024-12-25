VERSION 0.8
FROM ubuntu:jammy

ci:
  ARG EARTHLY_CI
  ARG EARTHLY_GIT_SHORT_HASH
  ARG git_sha=$EARTHLY_GIT_SHORT_HASH
  ARG --required version
  BUILD +check
  BUILD +build
  BUILD ./packages/backend+image --version=$version --git_sha=$git_sha
  IF [ $EARTHLY_CI = "true" ]
    BUILD ./packages/frontend+deploy --stage=prod --git_sha=$git_sha
  ELSE
    BUILD ./packages/frontend+deploy --stage=dev --git_sha=$git_sha
  END

build:
  BUILD ./packages/frontend+build

check:
  # BUILD ./packages/backend+check
  BUILD ./packages/data+check

deno:
  FROM denoland/deno
  WORKDIR /workspace

prepare:
  FROM +deps
  COPY packages packages
