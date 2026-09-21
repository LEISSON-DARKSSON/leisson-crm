# Paigaldab riigihangete radari kaks ajastatud ulesannet Windowsi
# ulesandeplaneerijasse. Jooksuta CRM-i juurest:
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File win\install-hanked-task.ps1 -Kuiv
#   powershell -NoProfile -ExecutionPolicy Bypass -File win\install-hanked-task.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File win\install-hanked-task.ps1 -Eemalda
#
# Kui skript ei ole peakoopias (nt jooksutad teda worktree'st), anna PUSIV CRM-i
# tee kaasa, muidu skript keeldub:
#   ... -File win\install-hanked-task.ps1 -Crm "C:\...\Leisson Creative\crm"
#
# -Kuiv trukib tapselt selle, mida ta teeks, JA EI KIRJUTA MIDAGI. Iga muudatus
# selles failis katsetatakse ainult kuivjooksuga; paris registreerimine on inimese
# otsus, mitte skripti oma.
#
# KAKS ULESANNET
#   "Leisson CRM hanked sync"    - iga paev 07:40, node agent\hanked-sync.mjs
#   "Leisson CRM hanked ajalugu" - kuu 3. paeval 05:00, node agent\hanked-history.mjs
#
# NIMETAMINE. Masinal on juba neli ulesannet ja koik kannavad mustrit
# "Leisson CRM <nimi>" ilma mottekriipsuta: saatja, loobumised, jarelkirjad,
# konduktor. Teostusplaani "LEISSON - hanked sync" oleks mustrist valjas ja kannaks
# U+2014 mottekriipsu, mis laheb schtasks/PowerShelli vaikekodeeringus prugiks -
# ja prugise nimega ulesannet ei leia -Eemalda enam ules.
#
# KELLAAEG. Moodetud 21.09.2026 (Get-ScheduledTask):
#   Leisson CRM konduktor    E-R kell 8-18, iga 30 minuti jarel (:00 ja :30 hoivatud)
#   Leisson CRM loobumised   iga paev hommikul, enne konduktori akent
#   Leisson CRM saatja       E-R tootundidel iga tund (keelatud, aeg jaab broneerituks)
#   Leisson CRM jarelkirjad  E-R hommikupoolikul (keelatud)
# 07:40 on enne konduktori akent ja ei lange uhegi olemasoleva kaivitusega kokku.
# Uks jooks paevas on piisav: lihthanke tahtaeg on mediaanis 12 paeva, min 6.
#
# MAGAV MASIN. -StartWhenAvailable teeb vahele jaanud jooksu jarele niipea, kui
# masin arkab. -WakeToRun on TEADLIKULT valjas: see on tooarvuti ja uhe hanke
# tahtaeg ei sole paari tunni parast ara.
#
# LOGI. Kuhugi faili ei suunata - nagu install-saatja.ps1-s, on jalg baasis.
# agent\hanked-sync.mjs kirjutab otsekaivitusel ise rea hanke_runs-i (cmd = sync,
# boot_id = "otse:...", seega CRM-i vaade ei paku talle "Peata" nuppu) ning selle
# rea log-veergu oma stdout-i JSON-read. Oine jooks on seega CRM-i vaates nahtav.
#
# LogonType Interactive: vajab sisselogitud kasutajat, paroole ulesandesse ei
# kirjutata - sama muster mis install-saatja.ps1-s.

# -Crm <tee>. Ajastatud ulesanne kannab CRM-i teed ENDA sees, seega see tee peab
# ule elama selle checkout'i, kust skript jooksutati. Ilma selle liputa vottis
# skript alati $PSScriptRoot vanema - ja kui teda jooksutati git worktree'st,
# lains ulesandesse ajutine tee (_worktrees\...), mis parast haru merge'imist ja
# worktree kustutamist KAOB. Ulesanne ei oleks siis veateatega kukkunud, vaid
# lihtsalt teatanud iga paev "0x80070002 - faili ei leitud" Task Scheduleri
# ajaloos, kuhu keegi ei vaata. Seega: worktree-tee on KEELATUD, kui sa ei utle
# -Crm-iga selgelt, kuhu ulesanne peab osutama.
param([switch]$Eemalda, [switch]$Kuiv, [string]$Crm)

$ErrorActionPreference = 'Stop'
$juur = if ($Crm) { (Resolve-Path -LiteralPath $Crm).Path } else { Split-Path -Parent $PSScriptRoot }

if (-not (Test-Path -LiteralPath (Join-Path $juur 'package.json') -PathType Leaf)) {
  throw ("CRM-i ei ole siin: " + $juur + " (package.json puudub). Anna oige tee -Crm lipuga.")
}
if (-not $Eemalda -and $juur -match '[\\/]_worktrees[\\/]') {
  throw ("Ajutine worktree-tee ei kolba ajastatud ulesandesse: " + $juur + "`n" +
    "  Ulesanne jaaks sellele teele osutama ka parast worktree kustutamist ja kukuks" +
    " iga paev vaikselt.`n" +
    "  Jooksuta skript peakoopiast, voi anna puusiv tee: -Crm 'C:\tee\crm'")
}

# TAPSELT need kaks nime. Metamarki ('Leisson CRM*') siin EI OLE: see tabaks ka
# saatjat, loobumisi, jarelkirju ja konduktorit, ehk -Eemalda kustutaks ara asju,
# mida ta ei paigaldanud.
$nimed = @('Leisson CRM hanked sync', 'Leisson CRM hanked ajalugu')

function EemaldaUlesanne {
  param([string]$Nimi)
  $olemas = Get-ScheduledTask -TaskName $Nimi -ErrorAction SilentlyContinue
  if (-not $olemas) {
    Write-Host ("Ei olnud paigaldatud: " + $Nimi)
    return
  }
  if ($Kuiv) {
    Write-Host ("KUIVJOOKS - eemaldaks: " + $Nimi + " (seis " + $olemas.State + ")")
    return
  }
  Unregister-ScheduledTask -TaskName $Nimi -Confirm:$false
  Write-Host ("Eemaldatud: " + $Nimi)
}

# Uks registreerimiskoht kahe ulesande jaoks. Kaks koopiat oleks tapselt see viis,
# kuidas -Kuiv valve uhes neist vaikselt kaduma laheb.
function PaigaldaUlesanne {
  param(
    [string]$Nimi,
    [string]$Skript,
    [string]$Argument,
    $Kaiviti,
    $Seaded,
    $Peaosa,
    [string]$Kirjeldus,
    [string]$Ajakava
  )

  # PUUDUVA SKRIPTIGA ULESANNET EI REGISTREERITA. agent\hanked-history.mjs valmib
  # alles ulesandes 12. Registreeritud ulesanne puuduva failiga kukuks iga kuu
  # vaikselt Task Scheduleri ajaloos, kuhu keegi ei vaata - ja "keelatuna
  # registreerimine" ainult lukkaks sama loksu edasi sellele, kes ta kunagi lubab.
  $tee = Join-Path $juur $Skript
  if (-not (Test-Path -LiteralPath $tee -PathType Leaf)) {
    Write-Host ("VAHELE JAETUD: " + $Nimi)
    Write-Host ("  skripti ei ole veel olemas: " + $Skript)
    Write-Host "  Ulesannet EI registreeritud - puuduva failiga ulesanne kukuks vaikselt."
    Write-Host "  Kui ulesanne 12 on tehtud, jooksuta see skript uuesti."
    return $false
  }

  if ($Kuiv) {
    Write-Host ("KUIVJOOKS - registreeriks: " + $Nimi)
    Write-Host ("  kask     : " + $node + " " + $Argument)
    Write-Host ("  kataloog : " + $juur + $(if ($Crm) { ' (-Crm)' } else { ' (skripti asukohast)' }))
    Write-Host ("  ajakava  : " + $Ajakava)
    Write-Host ("  kasutaja : " + $env:USERNAME + " (Interactive, LeastPrivilege)")
    Write-Host ("  olemas   : " + $(if (Get-ScheduledTask -TaskName $Nimi -ErrorAction SilentlyContinue) { 'jah, kirjutataks ule (-Force)' } else { 'ei, loodaks uus' }))
    return $true
  }

  Register-ScheduledTask -TaskName $Nimi -Action $Kaiviti[0] -Trigger $Kaiviti[1] `
    -Settings $Seaded -Principal $Peaosa -Description $Kirjeldus -Force | Out-Null
  Write-Host ("Paigaldatud: " + $Nimi + " - " + $Ajakava)
  return $true
}

if ($Eemalda) {
  foreach ($n in $nimed) { EemaldaUlesanne -Nimi $n }
  if ($Kuiv) {
    Write-Host ""
    Write-Host "KUIVJOOKS: midagi ei eemaldatud."
  } else {
    Write-Host ""
    Write-Host "Hangete automaatne sunk on VALJAS. CRM-i nupud tootavad edasi."
  }
  exit 0
}

# NODE PEAB OLEMA LEITAV. Ajastatud ulesanne jookseb teise keskkonnaga kui see
# konsool; kui (Get-Command node).Source on tuhi, annab Register-ScheduledTask
# segase vea ("Cannot bind argument to parameter 'Execute'"). Kontroll on siin.
$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  throw 'node.exe ei ole PATH-is. Paigalda Node.js voi lisa ta PATH-i ja jooksuta uuesti.'
}
$node = $nodeCmd.Source
if (-not (Test-Path -LiteralPath $node -PathType Leaf)) {
  throw ('node.exe tee ei kehti: ' + $node)
}
Write-Host ("node: " + $node)
Write-Host ("crm : " + $juur)
Write-Host ""

$peaosa = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

# --- 1. paevane sunk -------------------------------------------------------
$syncTegevus = New-ScheduledTaskAction -Execute $node -Argument 'agent\hanked-sync.mjs' -WorkingDirectory $juur
$syncKaiviti = New-ScheduledTaskTrigger -Daily -At '07:40'
# Sunk kestab sekundeid; 15 minutit on lagi ripuma jaanud vorguparingule.
# IgnoreNew: kui eelmine jooks veel kaib, ei kaivitata teist. Sama otsus on ka
# baasis (osaline unikaalindeks hanke_runs peal) - kaks valvet, uks tulemus.
$syncSeaded = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew

PaigaldaUlesanne -Nimi $nimed[0] -Skript 'agent\hanked-sync.mjs' `
  -Argument 'agent\hanked-sync.mjs' -Kaiviti @($syncTegevus, $syncKaiviti) `
  -Seaded $syncSeaded -Peaosa $peaosa `
  -Kirjeldus 'RHR RSS -> CRM. Jatab rea hanke_runs-i, vaade naitab teda nagu nupujooksu.' `
  -Ajakava 'iga paev 07:40' | Out-Null

# --- 2. kuine ajalugu ------------------------------------------------------
# New-ScheduledTaskTrigger EI TUNNE kuist kaivitit (-Once/-Daily/-Weekly/
# -AtLogOn/-AtStartup on koik, mis tal on) - teostusplaani koodiloige oleks
# kukkunud parameetrivea peale. Kuine kaiviti tuleb CIM-klassist.
# DaysOfMonth on BITIMASK: bitt 0 = kuu 1. paev, seega 3. paev = 4.
# MonthsOfYear 4095 = koik 12 kuud (0xFFF).
$kuuAlgus = [datetime]::Today.AddHours(5)
$kuuKaiviti = New-CimInstance -ClassName MSFT_TaskMonthlyTrigger `
  -Namespace Root/Microsoft/Windows/TaskScheduler -ClientOnly -Property @{
    StartBoundary = $kuuAlgus.ToString('yyyy-MM-ddTHH:mm:ss')
    DaysOfMonth   = [uint32]4
    MonthsOfYear  = [uint16]4095
    Enabled       = $true
  }
$kuuTegevus = New-ScheduledTaskAction -Execute $node -Argument 'agent\hanked-history.mjs --kuud=1' -WorkingDirectory $juur
# Ajaloo import kestab kumneid minuteid (eForms XML kuu kaupa), seega 4 tundi.
$kuuSeaded = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 4) -MultipleInstances IgnoreNew

PaigaldaUlesanne -Nimi $nimed[1] -Skript 'agent\hanked-history.mjs' `
  -Argument 'agent\hanked-history.mjs --kuud=1' -Kaiviti @($kuuTegevus, $kuuKaiviti) `
  -Seaded $kuuSeaded -Peaosa $peaosa `
  -Kirjeldus 'eForms kuuvarskendus: lepinguteated 24 kuu aknasse.' `
  -Ajakava 'kuu 3. paeval 05:00' | Out-Null

Write-Host ""
if ($Kuiv) {
  Write-Host "KUIVJOOKS: midagi ei registreeritud. Paris paigaldus: sama kask ilma -Kuiv liputa."
} else {
  $seis = Get-ScheduledTask -TaskName $nimed -ErrorAction SilentlyContinue
  if ($seis) { $seis | Format-Table TaskName, State -AutoSize }
  Write-Host "VALJA LULITAMINE: powershell -NoProfile -ExecutionPolicy Bypass -File win\install-hanked-task.ps1 -Eemalda"
}
