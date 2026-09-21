# Paigaldab KINNITATUD KAMPAANIATE saatja Windowsi ulesandeplaneerijasse.
#
# Uks ulesanne: "Leisson CRM kampaaniad"
#   E-R 09:00, kordus iga 10 minuti jarel 8 tunni jooksul (kuni 17:00).
#   Iga jooks saadab MAKSIMUM UHE kirja (agent/campaign-worker.mjs --sweep),
#   jarjekorras vanima kinnitusajaga kampaaniast. Paris tempo tuleb
#   lib/sendgate.mjs limiitidest: 40/paevas, 8/tunnis, >=7 min kirjade vahel,
#   ainult tooajal. Ulesanne on ajam, mitte limiit - limiit on varavas.
#
# Tapilukk: .env rida CRM_CAMPAIGN_SEND_ENABLED. 0 = seisab kohe, ilma et
# ulesannet peaks puutuma (loetakse iga jooksu alguses).
#
# LogonType Interactive: vajab sisselogitud kasutajat, paroole ei salvestata.
# Eemaldamine: .\win\install-kampaania.ps1 -Eemalda
#
# MARKUS: peata-vabalt kaivitamiseks (Desktop Commander, CI, mittetinteraktiivne
# konsool) kasuta win\paigalda-kampaania.cmd - seal on sama ulesanne schtasks-iga,
# ilma PowerShelli interaktiivse kihita, mis kaugkaivitusel rippuma jaab.

param([switch]$Eemalda)

$ErrorActionPreference = 'Stop'
$juur = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source
$nimi = 'Leisson CRM kampaaniad'

if ($Eemalda) {
  if (Get-ScheduledTask -TaskName $nimi -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $nimi -Confirm:$false
    Write-Host "Eemaldatud: $nimi"
  } else { Write-Host "Ei olnud paigaldatud: $nimi" }
  Write-Host "`nKinnitatud kampaaniate automaatsaatmine on VALJAS."
  exit 0
}

$tegevus = New-ScheduledTaskAction -Execute $node -Argument 'agent\campaign-worker.mjs --sweep' -WorkingDirectory $juur

# Weekly-kaiviti ei vota -RepetitionInterval otse vastu; kordusmuster tuleb
# ajutiselt Daily-kaivitilt ule tosta. See on dokumenteeritud PowerShelli tava.
$kaiviti = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At '09:00'
$muster  = (New-ScheduledTaskTrigger -Once -At '09:00' `
             -RepetitionInterval (New-TimeSpan -Minutes 10) `
             -RepetitionDuration (New-TimeSpan -Hours 8)).Repetition
$kaiviti.Repetition = $muster

$seaded = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew
$peaosa = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $nimi -Action $tegevus -Trigger $kaiviti -Settings $seaded `
  -Principal $peaosa -Force `
  -Description 'Saadab inimese kinnitatud kampaaniate kirju, uks kiri jooksu kohta. Tempo ja paevalimiit on lib/sendgate.mjs-is, tapilukk .env-is (CRM_CAMPAIGN_SEND_ENABLED).' | Out-Null

Write-Host "Paigaldatud: $nimi - E-R 09:00, kordus iga 10 min 8 tunni jooksul"
Write-Host ""
Get-ScheduledTask -TaskName $nimi | Select-Object TaskName,State | Format-Table -AutoSize
Write-Host "Seis:"
& $node (Join-Path $juur 'win\kampaania-seis.mjs')
Write-Host "`nVALJA LULITAMINE: .\win\install-kampaania.ps1 -Eemalda  (voi .env: CRM_CAMPAIGN_SEND_ENABLED=0)"
