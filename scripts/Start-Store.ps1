[CmdletBinding()]
param([string] $RuntimeDirectory, [ValidateRange(1024, 65535)][int] $Port = 8000, [string] $PhpExecutable, [switch] $OpenBrowser)
. "$PSScriptRoot\local-server-common.ps1"
$startup = [Diagnostics.Stopwatch]::StartNew()
$runtime = Get-StoreRuntime $RuntimeDirectory
$settings = Get-StoreSettings $runtime
if (Get-StoreProcess $settings) {
    if ($PSBoundParameters.ContainsKey('Port') -and $settings.Port -ne $Port) { throw 'Stop the project server before changing its port.' }
    Write-Host 'Checking the existing store server. Please wait...'
    Confirm-StoreReady $settings
    Write-Host 'This project is already running.'
    Show-StoreAddresses $settings.Port
    if ($OpenBrowser) { Start-Process $settings.Url }
    exit 0
}
if (-not $PSBoundParameters.ContainsKey('Port') -and $settings) { $Port = $settings.Port }
if (-not $PhpExecutable) {
    if ($env:PHP_EXECUTABLE) { $PhpExecutable = $env:PHP_EXECUTABLE }
    else {
        $command = Get-Command php.exe -ErrorAction SilentlyContinue
        if ($command) { $PhpExecutable = $command.Source }
        else { $PhpExecutable = 'C:\laragon\bin\php\php-8.3.30-Win32-vs16-x64\php.exe' }
    }
}
$php = (Resolve-Path -LiteralPath $PhpExecutable).Path
$app = Join-Path $storeRoot 'store-app'
foreach ($file in @("$app\vendor\autoload.php", "$app\.env", "$app\public\build\manifest.json")) {
    if (-not (Test-Path -LiteralPath $file)) { throw 'Complete the one-time dependency setup in README first.' }
}
if (-not (Test-StorePortAvailable $Port)) { throw "Port $Port is occupied. Stop your old terminal server or use -Port 8001." }
[void](New-Item -ItemType Directory -Path $runtime -Force)
$cache = Join-Path $runtime 'uncached-config.php'
if (Test-Path -LiteralPath $cache) { throw 'Unexpected runtime configuration cache; remove it before starting the demo.' }
$overrides = @{ SESSION_SECURE_COOKIE = 'false'; APP_DEBUG = 'false'; APP_CONFIG_CACHE = $cache }
$previous = @{}
Write-Host 'Starting the local store. Please wait...'
try {
    foreach ($name in $overrides.Keys) {
        $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $overrides[$name], 'Process')
    }
    $arguments = "artisan serve --host=0.0.0.0 --port=$Port --no-reload --no-ansi"
    $child = Start-Process -FilePath $php -ArgumentList $arguments -WorkingDirectory $app -WindowStyle Hidden -PassThru -RedirectStandardOutput "$runtime\server-output.log" -RedirectStandardError "$runtime\server-error.log"
    $settings = @{ Mode = 'artisan'; Runtime = $runtime; Php = $php; Port = $Port; Url = "http://127.0.0.1:$Port"; Pid = $child.Id; StartTicks = $child.StartTime.ToUniversalTime().Ticks }
    Write-StoreUtf8 "$runtime\settings.json" ($settings | ConvertTo-Json)
} finally {
    foreach ($name in $previous.Keys) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
Confirm-StoreReady $settings
Write-Host 'Store demo started.'
Write-Host ("Server started in {0:N1} seconds." -f $startup.Elapsed.TotalSeconds)
if ($OpenBrowser) { Start-Process $settings.Url }
Show-StoreAddresses $Port
