$ErrorActionPreference = 'Stop'
$taskProjectRoot = Split-Path -Parent $PSScriptRoot
$taskPackageEntries = @(
    'README.md', 'package.json', 'package-lock.json', '.env.example', '.gitignore', '.gitattributes',
    'src', 'public', 'tests', 'data', 'examples', 'docs', 'scripts'
)
$taskPackagePaths = foreach ($taskEntry in $taskPackageEntries) {
    $taskPath = Join-Path $taskProjectRoot $taskEntry
    if (-not (Test-Path -LiteralPath $taskPath)) { throw "Missing package entry: $taskEntry" }
    $taskPath
}
$taskOutputDirectory = Join-Path $taskProjectRoot 'dist'
New-Item -ItemType Directory -Path $taskOutputDirectory -Force | Out-Null
$taskArchivePath = Join-Path $taskOutputDirectory 'Content-Pilot-Submission.zip'
Compress-Archive -LiteralPath $taskPackagePaths -DestinationPath $taskArchivePath -CompressionLevel Optimal -Force
$taskArchiveHash = Get-FileHash -LiteralPath $taskArchivePath -Algorithm SHA256
Set-Content -LiteralPath (Join-Path $taskOutputDirectory 'SHA256.txt') -Value ($taskArchiveHash.Hash + '  Content-Pilot-Submission.zip') -Encoding UTF8
Write-Output ('Created: ' + $taskArchivePath)
Write-Output ('SHA256: ' + $taskArchiveHash.Hash)
