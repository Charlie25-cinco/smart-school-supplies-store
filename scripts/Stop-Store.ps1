[CmdletBinding()]
param([string] $RuntimeDirectory)
. "$PSScriptRoot\local-server-common.ps1"
$settings = Get-StoreSettings $RuntimeDirectory
$process = Get-StoreProcess $settings
if (-not $process) { Write-Host 'This project is already stopped.'; exit 0 }
# Artisan launches a PHP child; stop only the verified project process tree.
$previousPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F *> $null
    $stopStatus = $LASTEXITCODE
} finally { $ErrorActionPreference = $previousPreference }
if ($stopStatus -ne 0) { throw 'Could not stop the project server. No unrelated process was targeted.' }
for ($attempt = 0; $attempt -lt 50; $attempt++) {
    Start-Sleep -Milliseconds 200
    if (-not (Get-StoreProcess $settings) -and -not (Test-StorePort $settings.Port)) { Write-Host 'Store stopped.'; exit 0 }
}
throw 'The project server has not stopped yet.'
