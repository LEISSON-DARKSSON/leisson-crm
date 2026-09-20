# Paigaldab automaatse kulmkirjade saatja Windowsi ulesandeplaneerijasse.
#
# Kaks ulesannet:
#   1. "Leisson CRM saatja"      - iga tund 09-17 E-R, saadab kuni 4 kirja jooksu kohta
#   2. "Leisson CRM loobumised"  - iga paev 08:30, loeb postkastist loobumised ja summutab
#
# LogonType Interactive: vajab sisselogitud kasutajat, paroole ulesandesse ei kirjutata.
# Eemaldamine: .\win\install-saatja.ps1 -Eemalda

param([switch]$Eemalda)

$ErrorActionPreference = 'Stop'
$juur = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source

$nimed = @('Leisson CRM saatja', 'Leisson CRM loobumised', 'Leisson CRM jarelkirjad')

if ($Eemalda) {
  foreach ($n in $nimed) {
    if (Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $n -Confirm:$false
      Write-Host "Eemaldatud: $n"
    }
  }
  Write-Host "`nAutomaatne saatmine on VALJAS."
  exit 0
}

# --- 1. saatja: iga tund tooajal ---
$tegevus = New-ScheduledTaskAction -Execute $node -Argument 'agent\saatja.mjs' -WorkingDirectory $juur
$paevad = 'Monday','Tuesday','Wednesday','Thursday','Friday'
$kaivitid = @()
foreach ($h in 9..16) {
  $kaivitid += New-ScheduledTaskTrigger -Weekly -DaysOfWeek $paevad -At ([datetime]::Today.AddHours($h))
}
$seaded = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 45) -MultipleInstances IgnoreNew
$peaosa = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $nimed[0] -Action $tegevus -Trigger $kaivitid -Settings $seaded `
  -Principal $peaosa -Description 'Saadab ette valmistatud kulmkirju kindlas tempos. Paevalimiit ja toooaeg on lib/sendgate.mjs-is.' -Force | Out-Null
Write-Host "Paigaldatud: $($nimed[0]) - E-R kell 09-16, kuni 5 kirja jooksu kohta (40/paevas, 8/tunnis)"

# --- 2. loobumised: iga paev hommikul ---
$tegevus2 = New-ScheduledTaskAction -Execute $node -Argument 'agent\saatja.mjs --loobumised' -WorkingDirectory $juur
$kaiviti2 = New-ScheduledTaskTrigger -Daily -At '08:30'
$seaded2 = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $nimed[1] -Action $tegevus2 -Trigger $kaiviti2 -Settings $seaded2 `
  -Principal $peaosa -Description 'Loeb postkastist loobumised ja lisab need summutusnimekirja.' -Force | Out-Null
Write-Host "Paigaldatud: $($nimed[1]) - iga paev 08:30"

# --- 3. jarelkirjad: kord paevas, parast kulmkirjade akent ---
# Eraldi ulesanne ja eraldi paevalimiit: jarelkiri laheb inimesele, kes juba
# korra ei vastanud. Kaebuse risk on seal suurem kui esmakontaktil.
$tegevus3 = New-ScheduledTaskAction -Execute $node -Argument 'agent\jarelkiri.mjs' -WorkingDirectory $juur
$kaiviti3 = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $paevad -At ([datetime]::Today.AddHours(10).AddMinutes(30))
$seaded3 = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 40) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $nimed[2] -Action $tegevus3 -Trigger $kaiviti3 -Settings $seaded3 `
  -Principal $peaosa -Description 'Saadab jarelkirju neile, kes ei vastanud. Kaks puuet, iga kiri kannab uut moodetud fakti.' -Force | Out-Null
Write-Host "Paigaldatud: $($nimed[2]) - E-R kell 10:30, kuni 6 jarelkirja paevas"

Write-Host "`nSeis:"
& $node (Join-Path $juur 'agent\saatja.mjs') --seis
& $node (Join-Path $juur 'agent\jarelkiri.mjs') --seis
Write-Host "`nVALJA LULITAMINE: .\win\install-saatja.ps1 -Eemalda"
