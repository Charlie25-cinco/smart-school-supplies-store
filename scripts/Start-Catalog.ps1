[CmdletBinding()]
param([string] $RuntimeDirectory, [ValidateRange(1024, 65535)][int] $Port = 8080, [string] $PhpExecutable, [switch] $OpenBrowser)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$catalogRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$catalogDir = Join-Path $catalogRoot 'catalog'
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
function Test-CatalogPortAvailable([int] $Port) {
    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Any, $Port)
    try {
        $listener.Server.ExclusiveAddressUse = $true
        $listener.Start()
        return $true
    } catch [Net.Sockets.SocketException] { return $false } finally { $listener.Stop() }
}
function Confirm-CatalogReady($Settings) {
    $readiness = [Diagnostics.Stopwatch]::StartNew()
    $nextProgress = 10
    while ($readiness.Elapsed.TotalSeconds -lt 30) {
        if (-not (Get-CatalogProcess $Settings)) { throw 'The PHP catalog process ended before it became ready. Run Start Catalog.cmd again.' }
        if (Test-CatalogPort $Settings.Port) { return }
        if ($readiness.Elapsed.TotalSeconds -ge $nextProgress) {
            Write-Host 'The catalog is still starting. Please wait...'
            $nextProgress += 10
        }
        Start-Sleep -Milliseconds 100
    }
    if (-not (Get-CatalogProcess $Settings)) { throw 'The PHP catalog process ended before it became ready. Run Start Catalog.cmd again.' }
    throw 'The catalog did not become ready within 30 seconds. PHP is still running. Wait a moment and run Start Catalog.cmd again to reuse this process.'
}
$startup = [Diagnostics.Stopwatch]::StartNew()
$runtime = Get-CatalogRuntime $RuntimeDirectory
$settings = Get-CatalogSettings $runtime
if (Get-CatalogProcess $settings) {
    if ($PSBoundParameters.ContainsKey('Port') -and $settings.Port -ne $Port) { throw 'Stop the catalog preview before changing its port.' }
    Write-Host 'Checking the existing catalog preview. Please wait...'
    Confirm-CatalogReady $settings
    Write-Host 'The catalog preview is already running.'
    Write-Host ("Catalog: http://127.0.0.1:{0}" -f $settings.Port)
    if ($OpenBrowser) { Start-Process ("http://127.0.0.1:{0}" -f $settings.Port) }
    exit 0
}
if (-not $PSBoundParameters.ContainsKey('Port') -and $settings) { $Port = $settings.Port }
if (-not (Test-Path -LiteralPath (Join-Path $catalogDir 'index.html'))) { throw 'The catalog source is missing; restore the catalog directory first.' }
if (-not $PhpExecutable) {
    if ($env:PHP_EXECUTABLE) { $PhpExecutable = $env:PHP_EXECUTABLE }
    else {
        $command = Get-Command php.exe -ErrorAction SilentlyContinue
        if ($command) { $PhpExecutable = $command.Source }
        else { $PhpExecutable = 'C:\laragon\bin\php\php-8.3.30-Win32-vs16-x64\php.exe' }
    }
}
$php = (Resolve-Path -LiteralPath $PhpExecutable).Path
if (-not (Test-CatalogPortAvailable $Port)) { throw "Port $Port is occupied. Stop your old preview or use -Port 8081." }
# The preview always reflects the store database: refresh the catalog file
# from SQLite first. A failed refresh only warns; the previous file is served.
$exporter = Join-Path $catalogRoot 'scripts\export-catalog-products.php'
if ((Test-Path -LiteralPath (Join-Path $catalogRoot 'store-app\database\database.sqlite')) -and (Test-Path -LiteralPath $exporter)) {
    Write-Host 'Refreshing the catalog preview from the store database...'
    & $php $exporter
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Catalog refresh did not complete. Serving the previous catalog file.' }
} else {
    Write-Warning 'Store database or exporter missing. Serving the previous catalog file.'
}
[void](New-Item -ItemType Directory -Path $runtime -Force)
Write-Host 'Starting the catalog preview. Please wait...'
$child = Start-Process -FilePath $php -ArgumentList "-S 127.0.0.1:$Port", (Join-Path $catalogRoot 'scripts\catalog-router.php') -WorkingDirectory $catalogDir -WindowStyle Hidden -PassThru -RedirectStandardOutput "$runtime\server-output.log" -RedirectStandardError "$runtime\server-error.log"
$settings = @{ Mode = 'catalog'; Runtime = $runtime; Php = $php; Port = $Port; Pid = $child.Id; StartTicks = $child.StartTime.ToUniversalTime().Ticks }
[IO.File]::WriteAllText("$runtime\settings.json", ($settings | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
Confirm-CatalogReady $settings
Write-Host 'Catalog preview started.'
Write-Host ("Server started in {0:N1} seconds." -f $startup.Elapsed.TotalSeconds)
$url = ("http://127.0.0.1:{0}" -f $Port)
if ($OpenBrowser) { Start-Process $url }
Write-Host ("Catalog: {0}" -f $url)
