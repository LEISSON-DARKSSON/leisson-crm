# Leisson CRM - paigaldab kaivituse Windowsi sisselogimisel + toolaua ikooni.
# Jooksuta: powershell -ExecutionPolicy Bypass -File win\install-autostart.ps1
# Eemaldamiseks: powershell -ExecutionPolicy Bypass -File win\install-autostart.ps1 -Remove

param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$win  = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $win
$ico  = Join-Path $win 'leisson-crm.ico'
$open = Join-Path $win 'crm-open.vbs'
$srv  = Join-Path $win 'crm-server.vbs'

$startup = [Environment]::GetFolderPath('Startup')
$desktop = [Environment]::GetFolderPath('Desktop')
$lnkStartup = Join-Path $startup 'Leisson CRM (server).lnk'
$lnkDesktop = Join-Path $desktop 'Leisson CRM.lnk'

if ($Remove) {
    foreach ($p in @($lnkStartup, $lnkDesktop)) {
        if (Test-Path $p) {
            Remove-Item $p -Force
            Write-Host ("Eemaldatud: " + $p)
        }
    }
    Write-Host ""
    Write-Host "Valmis. Server jookseb kuni taaskaivituseni."
    Write-Host "Sulgemiseks: taskkill /f /im node.exe"
    exit 0
}

foreach ($f in @($ico, $open, $srv)) {
    if (-not (Test-Path $f)) { throw ("Fail puudub: " + $f) }
}

$wscript = Join-Path ([Environment]::SystemDirectory) 'wscript.exe'
if (-not (Test-Path $wscript)) { throw ("wscript.exe ei leitud: " + $wscript) }

$sh = New-Object -ComObject WScript.Shell

# 1) Startup: server taustal, ilma akent
$s = $sh.CreateShortcut($lnkStartup)
$s.TargetPath       = $wscript
$s.Arguments        = ('"' + $srv + '"')
$s.WorkingDirectory = $root
$s.IconLocation     = $ico
$s.Description      = 'Leisson CRM server (taustal, 127.0.0.1)'
$s.WindowStyle      = 7
$s.Save()
Write-Host ("Loodud: " + $lnkStartup)

# 2) Toolaud: avab CRM-i APP-vaates (kaivitab serveri, kui vaja)
$d = $sh.CreateShortcut($lnkDesktop)
$d.TargetPath       = $wscript
$d.Arguments        = ('"' + $open + '"')
$d.WorkingDirectory = $root
$d.IconLocation     = $ico
$d.Description      = 'Leisson CRM - muugitoru ja postkast'
$d.Save()
Write-Host ("Loodud: " + $lnkDesktop)

if (-not (Test-Path (Join-Path $root '.env'))) {
    Write-Host "HOIATUS: .env puudub. Jooksuta enne kaivitamist: npm run setup" -ForegroundColor Yellow
}
if (-not (Test-Path (Join-Path $root 'node_modules'))) {
    Write-Host "HOIATUS: node_modules puudub. Jooksuta: npm install" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Valmis."
Write-Host "  Sisselogimisel -> server kaivitub taustal"
Write-Host "  Toolaua ikoon  -> avab CRM-i oma aknas (app-vaade)"
Write-Host "  Logi           -> data\server.log"
