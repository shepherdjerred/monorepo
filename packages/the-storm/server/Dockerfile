# syntax=docker/dockerfile:1
#
# The Storm's Minecraft server image: itzg/minecraft-server with Paper
# pre-patched, every plugin jar baked in and verified, and the repository's
# config bundle. Build context: packages/the-storm (docker-bake.hcl target
# `the-storm-server`). See server/README.md for the jar set and how each config
# file reaches /data.

########################
## TheStorm.jar + MCBridge.jar
########################
# Gradle and Corretto majors match .mise.toml's gradle and java pins
# (minecraft-tsmc.test.ts enforces the Gradle version). Renovate's Dockerfile
# manager updates every FROM pin in this file.
FROM gradle:9.9.2-jdk25-corretto@sha256:655ec9b518f5cacb08484a860e2f9baf5c1f586d484b7209935642ba619c56b4 AS plugin
WORKDIR /src
COPY plugin/ plugin/
COPY public-status.json public-status.json
# The world module verifies its managed rollout key during compilation.
# `managed-flags` is a BuildKit named context supplied by docker-bake.hcl.
# hadolint ignore=DL3022
COPY --from=managed-flags managed-flag-inventory.json /feature-flags/src/managed-flag-inventory.json
# The companions and safety modules bundle their shared brain contracts from
# ../../storm-brain/contracts (relative to plugin/); without it TheStorm fails
# to enable. `storm-brain-contracts` is a BuildKit named context.
# hadolint ignore=DL3022
COPY --from=storm-brain-contracts companion-chat.json content-moderation.json /storm-brain/contracts/
# hadolint ignore=DL3022
COPY --from=mc-harness-contracts evidence-contract.json /mc-harness/src/protocol/evidence-contract.json
RUN --mount=type=cache,id=the-storm-gradle,target=/home/gradle/.gradle/caches \
  gradle -p plugin :dist:shadowJar :bridge:jar --no-daemon --console=plain

########################
## Paper + third-party jars
########################
# Keep this digest equal to the version catalog's itzg/minecraft-server pin
# (minecraft-tsmc.test.ts enforces it; renovate.json groups both into one PR).
FROM itzg/minecraft-server:2026.11.1-java25@sha256:0634ff76eee896c7e9760a35117d24fad394857d10bc8c1d9bc7f7ff7deef3c2 AS fetch
COPY server/plugins.json server/fetch.sh /build/
RUN bash /build/fetch.sh plugins /build/plugins.json /out
COPY server/build-livemap.sh /build/
COPY server/livemap/ /build/livemap/
# Use the verified jar's matching frontend without changing the plugin artifact.
RUN bash /build/build-livemap.sh \
  "/out/plugins/$(jq -r '.plugins[] | select(.name == "BlueMap") | .file' /build/plugins.json)" \
  /out/livemap
# Pre-extract Paperclip (Mojang server jar download, patch, libraries) at build
# time so a wake needs no network. Paper reads it back via -DbundlerRepoDir.
WORKDIR /out/paper
RUN java -Dpaperclip.patchonly=true -jar "$(jq -r .paper.file /build/plugins.json)" \
  && chmod -R a+rX /out
# The rwf bots' baked navigation meshes are not in Git and never come from the
# build context (Dockerfile.dockerignore): the tracked manifest names each one
# by sha256, and the same verified download as the jars fetches it from the
# asset bucket. Last in this stage, so a rebake re-runs only this layer.
COPY server/owned/plugins/TheStorm/rwf/nav-manifest.json /build/nav-manifest.json
RUN bash /build/fetch.sh nav /build/nav-manifest.json /out/nav \
  && chmod -R a+rX /out/nav

########################
## release image
########################
FROM itzg/minecraft-server:2026.11.1-java25@sha256:0634ff76eee896c7e9760a35117d24fad394857d10bc8c1d9bc7f7ff7deef3c2 AS release
COPY --from=fetch /out/paper/ /opt/paper/
COPY --from=fetch /out/paper-defaults/ /opt/paper-defaults/
COPY --from=fetch /out/plugins/ /plugins/
COPY --from=fetch /out/livemap/ /opt/the-storm/livemap/
COPY --from=plugin --chmod=0644 /src/plugin/dist/build/libs/TheStorm.jar /plugins/
# MCBridge: the mc-harness agent bridge (HTTP on MC_BRIDGE_PORT, default 25580,
# reached only by kubectl port-forward). It disables itself without
# MC_BRIDGE_TOKEN, which the chart injects from 1Password.
COPY --from=plugin --chmod=0644 /src/plugin/bridge/build/libs/MCBridge.jar /plugins/
# Repository-owned plugin files (every file under server/owned/plugins/) ride
# itzg's /plugins sync into /data/plugins: overwritten when they differ, never
# deleted. Secrets never live here; patches interpolate ${CFG_*} env instead.
COPY server/owned/plugins/ /plugins/
# The navigation meshes rwf/nav-manifest.json names, beside each map's files.
COPY --from=fetch /out/nav/ /plugins/TheStorm/rwf/
COPY server/owned.roots server/remove.list /bundle/
COPY server/patches/ /bundle/patches/
COPY server/world-protection/ /bundle/world-protection/
COPY server/plugins.json /opt/the-storm/plugins.json
COPY server/assets/server-icon.png /opt/the-storm/server-icon.png
COPY server/archive-progression.py /opt/the-storm/archive-progression.py
COPY server/maintenance/startup.py /opt/the-storm/world-retirement.py
COPY server/maintenance/skylands.py /opt/the-storm/skylands-startup.py
COPY server/maintenance/files.py server/maintenance/skylands.py /opt/the-storm/maintenance/
COPY server/maintenance/skylands_transfer.py /opt/the-storm/skylands-transfer.py
COPY server/skylands-transfer.json /bundle/skylands-transfer.json
COPY --chmod=0755 server/storm-entrypoint.sh /usr/local/bin/storm-entrypoint

# PAPER_CUSTOM_JAR + bundlerRepoDir: run the pre-patched Paper, no download.
# PATCH_DEFINITIONS: force the keys we set in files plugins rewrite themselves.
# SYNC_SKIP_NEWER_IN_DESTINATION=false: the image wins over a plugin's rewrite.
# The towns module owns locks. Every stale top-level jar is retired.
ENV TYPE=PAPER \
  VERSION=26.3 \
  CFG_PROXY_PROTOCOL=false \
  CFG_COREPROTECT_DONATION_KEY="" \
  PAPER_CUSTOM_JAR=/opt/paper/paper-26.3-251.jar \
  JVM_DD_OPTS=bundlerRepoDir:/opt/paper \
  JVM_OPTS="-Dpaper.maxChatCommandInputSize=4096 -Dchunky.maxWorkingCount=4 -Dchunky.awaitTicketRemoval=true" \
  PAPER_CONFIG_DEFAULTS_REPO=/opt/paper-defaults \
  PATCH_DEFINITIONS=/bundle/patches \
  SYNC_SKIP_NEWER_IN_DESTINATION=false \
  REMOVE_OLD_MODS=true \
  REMOVE_OLD_MODS_EXCLUDE=

ENTRYPOINT ["/usr/local/bin/storm-entrypoint"]

########################
## smoke
########################
FROM release AS smoke
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
# Every third-party jar matches its pin, the jar set is exactly the manifest
# plus TheStorm.jar and MCBridge.jar, both are Paper plugins, Paper is pre-patched at
# the path PAPER_CUSTOM_JAR names, every navigation mesh rwf/nav-manifest.json
# names is present with its exact bytes and the lobby and each map has one, and
# every patch op is a $put (a $set on a key an older file lacks stops the boot).
RUN set -eu; \
  paper_version=$(jq -r '.paper.version | split("-")[0]' /opt/the-storm/plugins.json); \
  [ "$VERSION" = "$paper_version" ]; \
  [ "$PAPER_CUSTOM_JAR" = "/opt/paper/$(jq -r .paper.file /opt/the-storm/plugins.json)" ]; \
  jq -r '.plugins[] | "\(.sha256)  /plugins/\(.file)"' /opt/the-storm/plugins.json \
    | sha256sum --check --strict -; \
  expected=$( { jq -r '.plugins[].file' /opt/the-storm/plugins.json; \
    echo TheStorm.jar; echo MCBridge.jar; } | sort); \
  actual=$(find /plugins -maxdepth 1 -name '*.jar' -printf '%f\n' | sort); \
  [ "$expected" = "$actual" ] || { echo "jar set mismatch"; diff <(echo "$expected") <(echo "$actual"); exit 1; }; \
  unzip -p /plugins/TheStorm.jar paper-plugin.yml > /tmp/paper-plugin.yml; \
  grep -qx 'name: TheStorm' /tmp/paper-plugin.yml; \
  grep -Fxq "api-version: '$paper_version'" /tmp/paper-plugin.yml; \
  grep -qx 'main: com.shepherdjerred.thestorm.TheStormPlugin' /tmp/paper-plugin.yml; \
  unzip -l /plugins/TheStorm.jar contracts/companion-chat.json > /dev/null; \
  unzip -l /plugins/TheStorm.jar contracts/content-moderation.json > /dev/null; \
  unzip -l /plugins/TheStorm.jar contracts/evidence-contract.json > /dev/null; \
  unzip -p /plugins/MCBridge.jar paper-plugin.yml > /tmp/mcbridge-plugin.yml; \
  grep -qx 'name: MCBridge' /tmp/mcbridge-plugin.yml; \
  grep -Fxq "api-version: \"$paper_version\"" /tmp/mcbridge-plugin.yml; \
  grep -qx 'main: com.shepherdjerred.mcbridge.McBridgePlugin' /tmp/mcbridge-plugin.yml; \
  test -f "$PAPER_CUSTOM_JAR"; \
  test -f "/opt/paper/versions/$paper_version/paper-$paper_version.jar"; \
  test -f /plugins/TheStorm/config.yml; \
  nav_manifest=/plugins/TheStorm/rwf/nav-manifest.json; \
  jq -e '.objects | length > 0' "$nav_manifest" > /dev/null; \
  jq -r '.objects[] | "\(.sha256)  /plugins/TheStorm/rwf/\(.path)"' "$nav_manifest" \
    | sha256sum --check --strict --quiet -; \
  jq -r '.objects[] | "\(.bytes) /plugins/TheStorm/rwf/\(.path)"' "$nav_manifest" \
    | while read -r bytes mesh; do \
        [ "$(stat -c %s "$mesh")" = "$bytes" ] || { echo "$mesh is not $bytes bytes"; exit 1; }; \
      done; \
  expected_meshes=$(jq -r '.objects[].path' "$nav_manifest" | sort); \
  actual_meshes=$(cd /plugins/TheStorm/rwf && find . -name nav.rwfnav -printf '%P\n' | sort); \
  [ "$expected_meshes" = "$actual_meshes" ] \
    || { echo "nav.rwfnav files differ from nav-manifest.json"; diff <(echo "$expected_meshes") <(echo "$actual_meshes"); exit 1; }; \
  needed_meshes=$(cd /plugins/TheStorm/rwf && { echo lobby/nav.rwfnav; \
    find maps -mindepth 1 -maxdepth 1 -type d -printf '%p/nav.rwfnav\n'; } | sort); \
  [ "$expected_meshes" = "$needed_meshes" ] \
    || { echo "nav-manifest.json does not name one mesh for the lobby and each map"; diff <(echo "$expected_meshes") <(echo "$needed_meshes"); exit 1; }; \
  grep -q '<title>LiveMap</title>' /opt/the-storm/livemap/index.html; \
  for patch in /bundle/patches/*.json; do \
    jq -e '(.file | startswith("/data/")) and (.ops | length > 0) and all(.ops[]; keys == ["$put"])' \
      "$patch" > /dev/null || { echo "patch $patch must be /data-targeted \$put ops only"; exit 1; }; \
  done; \
  bad=$(awk '!/^(#|$)/ && /^\/|\.\.|[][*?]|\/$/' /bundle/remove.list); \
  [ -z "$bad" ] || { echo "remove.list entries must be plain relative file paths: $bad"; exit 1; }; \
  unreadable=$(setpriv --reuid=1000 --regid=3000 --clear-groups \
    find /plugins /bundle /opt/paper /opt/paper-defaults /opt/the-storm ! -readable -print -quit); \
  [ -z "$unreadable" ] || { echo "not readable by the server user: $unreadable"; exit 1; }; \
  echo "the-storm-server smoke passed"

FROM release AS image
