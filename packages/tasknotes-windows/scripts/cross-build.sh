#!/bin/bash
# Builds every Windows project, the app's MSIX, and the self-contained
# unpackaged win-x64 executable inside the windows-cross-compiler-winui image.
# Run from packages/tasknotes-windows.
set -euo pipefail

output=${1:-AppPackages/cross}
standalone=${2:-AppPackages/win-x64-standalone}
projects=(
  src/TaskNotes.Windows.App/TaskNotes.Windows.App.csproj
  tests/TaskNotes.Windows.App.Tests/TaskNotes.Windows.App.Tests.csproj
  tests/TaskNotes.Windows.E2E/TaskNotes.Windows.E2E.csproj
)

for project in "${projects[@]}"; do
  dotnet restore "$project" --locked-mode
done
export FacetPreparedNotices=true
dotnet msbuild "${projects[0]}" -target:VerifyPreparedFacetNotices -property:FacetPreparedNotices=true
for project in "${projects[@]:1}"; do
  dotnet build "$project" --configuration Release --no-restore
done
dotnet build "${projects[0]}" --configuration Release --no-restore \
  -p:GenerateAppxPackageOnBuild=true -p:AppxPackageDir="$PWD/$output/"

dotnet restore "${projects[0]}" -r win-x64 -p:SelfContained=true --locked-mode
dotnet publish "${projects[0]}" \
  -c Release -r win-x64 -p:Platform=x64 \
  -p:SelfContained=true \
  -p:WindowsPackageType=None \
  -p:WindowsAppSDKSelfContained=true \
  -p:EnableMsixTooling=false \
  -p:DisableMsixProjectCapabilityAddedByProject=true \
  -p:FacetPreparedNotices=true \
  --no-restore \
  -o "$PWD/$standalone"
