Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$storeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
function Get-StoreRuntime([string] $Directory) {
    $base = Join-Path $storeRoot '.runtime'
    if (-not $Directory) { return (Join-Path $base 'artisan') }
    $resolved = [IO.Path]::GetFullPath($Directory)
    if (-not $resolved.StartsWith($base + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Runtime must be inside a project .runtime subdirectory.' }
    return $resolved
}
function Get-StoreSettings([string] $Directory) {
    $path = Join-Path (Get-StoreRuntime $Directory) 'settings.json'
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    $settings = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    if ($settings.Runtime -ne (Get-StoreRuntime $Directory) -or $settings.Mode -ne 'artisan') { throw 'Invalid Artisan launch settings.' }
    return $settings
}
function Get-StoreProcess($Settings) {
    if (-not $Settings) { return $null }
    $process = Get-Process -Id $Settings.Pid -ErrorAction SilentlyContinue
    if (-not $process) { return $null }
    if (-not $process.Path -or -not $process.Path.Equals($Settings.Php, [StringComparison]::OrdinalIgnoreCase) -or $Settings.StartTicks -ne $process.StartTime.ToUniversalTime().Ticks) { throw 'The recorded PID belongs to a different process; it will not be controlled.' }
    return $process
}
function Test-StorePort([int] $Port) {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $task = $client.ConnectAsync('127.0.0.1', $Port)
        if (-not $task.Wait(400)) { return $false }
        return $client.Connected
    } catch { return $false } finally { $client.Dispose() }
}
function Write-StoreUtf8([string] $Path, [string] $Text) {
    [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding $false))
}
function Show-StoreAddresses([int] $Port) {
    Write-Host "Main computer: http://127.0.0.1:$Port"
    $addresses = @([Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
        Where-Object { $_.OperationalStatus -eq 'Up' -and $_.NetworkInterfaceType -ne 'Loopback' } |
        ForEach-Object { $_.GetIPProperties().UnicastAddresses } |
        Where-Object { $_.Address.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork } |
        ForEach-Object { $_.Address.ToString() } |
        Where-Object { $_ -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.)' } | Select-Object -Unique)
    foreach ($address in $addresses) { Write-Host "Possible store-network link: http://$($address):$Port" }
    Write-Host 'Phones/tablets use the address of your active store Wi-Fi/Ethernet connection.'
}
