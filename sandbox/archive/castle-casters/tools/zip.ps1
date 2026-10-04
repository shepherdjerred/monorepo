param([Parameter(Mandatory=$true)][string]$InputPath, [Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
Compress-Archive -LiteralPath $InputPath -DestinationPath $OutputPath
