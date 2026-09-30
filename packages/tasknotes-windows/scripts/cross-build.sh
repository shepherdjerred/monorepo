#!/bin/bash
# Builds every Windows project and the app's MSIX inside the
# windows-cross-compiler-winui image. Run from packages/tasknotes-windows.
set -euo pipefail

output=${1:-AppPackages/cross}
projects=(
  src/TaskNotes.Windows.App/TaskNotes.Windows.App.csproj
  tests/TaskNotes.Windows.App.Tests/TaskNotes.Windows.App.Tests.csproj
  tests/TaskNotes.Windows.E2E/TaskNotes.Windows.E2E.csproj
)

for project in "${projects[@]}"; do
  dotnet restore "$project" --locked-mode
done
for project in "${projects[@]:1}"; do
  dotnet build "$project" --configuration Release --no-restore
done
dotnet build "${projects[0]}" --configuration Release --no-restore \
  -p:GenerateAppxPackageOnBuild=true -p:AppxPackageDir="$PWD/$output/"
