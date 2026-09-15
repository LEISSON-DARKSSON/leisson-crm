# Stop only the process listening on this CRM's port with this exact absolute server script.
# Legacy relative "node server.mjs" is deliberately refused: verify its cwd separately once.
$ErrorActionPreference = 'Stop'
$crmRoot = [IO.Path]::GetFullPath((Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)))
$serverScript = Join-Path $crmRoot 'server.mjs'
$crmPort = 4310
$envFile = Join-Path $crmRoot '.env'
if (Test-Path -LiteralPath $envFile) {
  foreach ($line in Get-Content -LiteralPath $envFile) {
    if ($line -match '^CRM_PORT=(\d+)$') { $crmPort = [int]$Matches[1] }
  }
}
if ($crmPort -lt 1 -or $crmPort -gt 65535) { throw 'Invalid CRM port' }
$owners = @(Get-NetTCPConnection -State Listen -LocalPort $crmPort -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
if ($owners.Count -gt 1) { throw 'Multiple processes listen on the CRM port; inspect manually' }
if ($owners.Count -eq 1) {
  $processId = [int]$owners[0]
  $candidate = Get-CimInstance Win32_Process -Filter "ProcessId=$processId"
  $quotedScript = [regex]::Escape($serverScript)
  $exactCommand = '^\s*(?:"[^"]*node\.exe"|[^\s"]*node(?:\.exe)?)\s+"?' + $quotedScript + '"?\s*$'
  if ($candidate.Name -ne 'node.exe' -or $candidate.CommandLine -notmatch $exactCommand) {
    throw 'Port owner is not verified as the exact absolute CRM script. Verify its cwd before any manual stop.'
  }
  $target = Get-Process -Id $processId -ErrorAction Stop
  if ([Math]::Abs(($target.StartTime - $candidate.CreationDate).TotalSeconds) -gt 2) { throw 'Process identity changed during verification' }
  Stop-Process -InputObject $target -ErrorAction Stop
  $target.WaitForExit(10000) | Out-Null
  if (-not $target.HasExited) { throw 'Verified CRM process did not exit' }
}
$vbs = Join-Path $crmRoot 'win\crm-server.vbs'
if (-not (Test-Path -LiteralPath $vbs)) { throw 'CRM launcher missing' }
Start-Process -FilePath (Join-Path ([Environment]::SystemDirectory) 'wscript.exe') -ArgumentList "//B //Nologo `"$vbs`"" -WindowStyle Hidden
$url = "http://127.0.0.1:$crmPort/api/state"
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 700
  try {
    $result = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
    if ($result.StatusCode -eq 200) { Write-Host "CRM responds: $url"; exit 0 }
  } catch { }
}
throw 'CRM did not respond. See data/server.log.'
