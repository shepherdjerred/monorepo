# syntax=docker/dockerfile:1
#
# The Storm's Minecraft server image: itzg/minecraft-server with Paper
# pre-patched, every plugin jar baked in and verified, and the repository's
# config bundle. Build context: packages/the-storm (docker-bake.hcl target
# `the-storm-server`). See server/README.md for the jar set and how each config
# file reaches /data.

########################
## TheStorm.jar
########################
# Gradle 9.7.1 on Corretto 25, matching .mise.toml's gradle and java pins.
# renovate: datasource=docker depName=gradle
FROM gradle:9.7.1-jdk25-corretto@sha256:b65cce4c0be158a0ddb99e431d329d40c02f99c567e0fffdad52d3e44815aa16 AS plugin
WORKDIR /src
COPY plugin/ plugin/
RUN --mount=type=cache,id=the-storm-gradle,target=/home/gradle/.gradle/caches \
  gradle -p plugin :dist:shadowJar --no-daemon --console=plain

########################
## LWCX
########################
# LWCX's 26.2-compatible releases are published only on SpigotMC, which blocks
# scripted downloads, so it is built from a pinned upstream commit (2.4.2 plus
# the pale oak sign fix). The project pins Java 21 and the Gradle 8.7 wrapper.
# renovate: datasource=docker depName=gradle
FROM gradle:8.7.0-jdk21@sha256:afba668dbed80665ed2cee8b16010c51e9639be3424c3f897637701bdd89371b AS lwcx
# renovate: datasource=git-refs depName=https://github.com/pop4959/LWCX branch=master
ARG LWCX_COMMIT=3cb6ce9f2a75261ebef40fada026b88539c88c95
WORKDIR /lwcx
RUN git init -q . \
  && git remote add origin https://github.com/pop4959/LWCX.git \
  && git fetch -q --depth 1 origin "${LWCX_COMMIT}" \
  && git checkout -q FETCH_HEAD
RUN --mount=type=cache,id=the-storm-lwcx-gradle,target=/home/gradle/.gradle/caches \
  gradle shadowJar --no-daemon --console=plain \
  && cp build/libs/LWC-2.4.2.jar /LWCX-2.4.2.jar

########################
## Paper + third-party jars
########################
# Keep this digest equal to the version catalog's itzg/minecraft-server pin
# (minecraft-tsmc.test.ts enforces it).
# renovate: datasource=docker depName=itzg/minecraft-server
FROM itzg/minecraft-server:2026.9.1-java25@sha256:e8640538dac5d54c2838d57fa9641e735ad0cf2b71fb0e8a68da3b542a315749 AS fetch
COPY server/plugins.json server/fetch.sh /build/
RUN bash /build/fetch.sh /build/plugins.json /out
# Pre-extract Paperclip (Mojang server jar download, patch, libraries) at build
# time so a wake needs no network. Paper reads it back via -DbundlerRepoDir.
WORKDIR /out/paper
RUN java -Dpaperclip.patchonly=true -jar "$(jq -r .paper.file /build/plugins.json)" \
  && chmod -R a+rX /out

########################
## release image
########################
FROM itzg/minecraft-server:2026.9.1-java25@sha256:e8640538dac5d54c2838d57fa9641e735ad0cf2b71fb0e8a68da3b542a315749 AS release
COPY --from=fetch /out/paper/ /opt/paper/
COPY --from=fetch /out/paper-defaults/ /opt/paper-defaults/
COPY --from=fetch /out/plugins/ /plugins/
COPY --from=lwcx --chmod=0644 /LWCX-2.4.2.jar /plugins/
COPY --from=plugin --chmod=0644 /src/plugin/dist/build/libs/TheStorm.jar /plugins/
# Repository-owned plugin files (every file under server/owned/plugins/) ride
# itzg's /plugins sync into /data/plugins: overwritten when they differ, never
# deleted. Secrets never live here; patches interpolate ${CFG_*} env instead.
COPY server/owned/plugins/ /plugins/
COPY server/owned.roots /bundle/owned.roots
COPY server/patches/ /bundle/patches/
COPY server/plugins.json /opt/the-storm/plugins.json
COPY --chmod=0755 server/storm-entrypoint.sh /usr/local/bin/storm-entrypoint

# PAPER_CUSTOM_JAR + bundlerRepoDir: run the pre-patched Paper, no download.
# PATCH_DEFINITIONS: force the keys we set in files plugins rewrite themselves.
# SYNC_SKIP_NEWER_IN_DESTINATION=false: the image wins over a plugin's rewrite.
# REMOVE_OLD_MODS: /data/plugins/*.jar is exactly the image's jar set.
ENV TYPE=PAPER \
  VERSION=26.2 \
  PAPER_CUSTOM_JAR=/opt/paper/paper-26.2-129.jar \
  JVM_DD_OPTS=bundlerRepoDir:/opt/paper \
  PAPER_CONFIG_DEFAULTS_REPO=/opt/paper-defaults \
  PATCH_DEFINITIONS=/bundle/patches \
  SYNC_SKIP_NEWER_IN_DESTINATION=false \
  REMOVE_OLD_MODS=true

ENTRYPOINT ["/usr/local/bin/storm-entrypoint"]

########################
## smoke
########################
FROM release AS smoke
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
# Every third-party jar matches its pin, the jar set is exactly the manifest
# plus the two built jars, TheStorm.jar is a Paper plugin, and Paper is
# pre-patched at the path PAPER_CUSTOM_JAR names.
RUN set -eu; \
  jq -r '.plugins[] | "\(.sha256)  /plugins/\(.file)"' /opt/the-storm/plugins.json \
    | sha256sum --check --strict -; \
  expected=$( { jq -r '.plugins[].file' /opt/the-storm/plugins.json; \
    echo LWCX-2.4.2.jar; echo TheStorm.jar; } | sort); \
  actual=$(find /plugins -maxdepth 1 -name '*.jar' -printf '%f\n' | sort); \
  [ "$expected" = "$actual" ] || { echo "jar set mismatch"; diff <(echo "$expected") <(echo "$actual"); exit 1; }; \
  unzip -p /plugins/TheStorm.jar paper-plugin.yml > /tmp/paper-plugin.yml; \
  grep -qx 'name: TheStorm' /tmp/paper-plugin.yml; \
  grep -qx "api-version: '26.2'" /tmp/paper-plugin.yml; \
  grep -qx 'main: com.shepherdjerred.thestorm.TheStormPlugin' /tmp/paper-plugin.yml; \
  unzip -p /plugins/LWCX-2.4.2.jar plugin.yml | grep -qx 'version: 2.4.2'; \
  test -f "$PAPER_CUSTOM_JAR"; \
  test -f /opt/paper/versions/26.2/paper-26.2.jar; \
  test -f /plugins/TheStorm/config.yml; \
  for patch in /bundle/patches/*.json; do jq -e '.file and (.ops | length > 0)' "$patch" > /dev/null; done; \
  unreadable=$(setpriv --reuid=1000 --regid=3000 --clear-groups \
    find /plugins /bundle /opt/paper /opt/paper-defaults /opt/the-storm ! -readable -print -quit); \
  [ -z "$unreadable" ] || { echo "not readable by the server user: $unreadable"; exit 1; }; \
  echo "the-storm-server smoke passed"

FROM release AS image
