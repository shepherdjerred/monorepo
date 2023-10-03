#!/bin/sh
set -e

echo "Activating feature 'Earthly'"

VERSION=${VERSION:-latest}
echo "The provided version is: $VERSION"
LOCATION=${LOCATION:-/usr/local/bin}
echo "The provided location is: $LOCATION"
BOOTSTRAP=${BOOTSTRAP:-true}
echo "The provided bootstrap is: $BOOTSTRAP"

ARCHITECTURE=$(uname -m)

if [ "$ARCHITECTURE" = "x86_64" ]; then
  ARCHITECTURE="amd64"
fi

if [ "$ARCHITECTURE" = "aarch64" ]; then
  ARCHITECTURE="arm64"
fi

if [ "$VERSION" = "latest" ]; then
  wget "https://github.com/earthly/earthly/releases/$VERSION/download/earthly-linux-$ARCHITECTURE" -O "$LOCATION/earthly"
else
  wget "https://github.com/earthly/earthly/releases/download/$VERSION/earthly-linux-$ARCHITECTURE" -O "$LOCATION/earthly"
fi;
chmod +x "$LOCATION/earthly"

if [ "$BOOTSTRAP" = "true" ]; then
  "$LOCATION/earthly" bootstrap --with-autocomplete
fi
