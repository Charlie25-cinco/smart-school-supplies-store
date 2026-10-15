[CmdletBinding()]
param([string] $RuntimeDirectory)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$catalogRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
function Get-CatalogRuntime([string] $Directory) {
    $base = Join-Path $catalogRoot '.runtime'
    if (-not $Directory) { return (Join-Path $base 'catalog') }
    $resolved = [IO.Path]::GetFullPath($Directory)
    if (-not $resolved.StartsWith($base + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Runtime must be inside a project .runtime subdirectory.' }
    return $resolved
}
function Get-CatalogSettings([string] $Directory) {
    $path = Join-Path (Get-CatalogRuntime $Directory) 'settings.json'
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    $settings = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    if ($settings.Runtime -ne (Get-CatalogRuntime $Directory) -or $settings.Mode -ne 'catalog') { throw 'Invalid catalog launch settings.' }
    return $settings
}
function Get-CatalogProcess($Settings) {
    if (-not $Settings) { return $null }
    $process = Get-Process -Id $Settings.Pid -ErrorAction SilentlyContinue
    if (-not $process) { return $null }
    try {
        if ($process.HasExited) { return $null }
        $processPath = $process.Path
        $processStartTicks = $process.StartTime.ToUniversalTime().Ticks
    } catch {
        if (-not (Get-Process -Id $Settings.Pid -ErrorAction SilentlyContinue)) { return $null }
        throw
    }
    if (-not $processPath -or -not $processPath.Equals($Settings.Php, [StringComparison]::OrdinalIgnoreCase) -or $Settings.StartTicks -ne $processStartTicks) {
        if ($process.HasExited -or -not (Get-Process -Id $Settings.Pid -ErrorAction SilentlyContinue)) { return $null }
        throw 'The recorded PID belongs to a different process; it will not be controlled.'
    }
    return $process
}
function Test-CatalogPort([int] $Port) {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $task = $client.ConnectAsync('127.0.0.1', $Port)
        if (-not $task.Wait(400)) { return $false }
        return $client.Connected
    } catch { return $false } finally { $client.Dispose() }
}
$settings = Get-CatalogSettings $RuntimeDirectory
$process = Get-CatalogProcess $settings
if (-not $process) { Write-Host 'The catalog preview is already stopped.'; exit 0 }
# The preview is a single PHP process; stop only the verified project process tree.
$previousPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F *> $null
    $stopStatus = $LASTEXITCODE
} finally { $ErrorActionPreference = $previousPreference }
if ($stopStatus -ne 0) { throw 'Could not stop the catalog preview. No unrelated process was targeted.' }
for ($attempt = 0; $attempt -lt 50; $attempt++) {
    Start-Sleep -Milliseconds 200
    if (-not (Get-CatalogProcess $settings) -and -not (Test-CatalogPort $settings.Port)) { Write-Host 'Catalog preview stopped.'; exit 0 }
}
throw 'The catalog preview has not stopped yet.'
