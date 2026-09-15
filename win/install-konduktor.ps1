# Register a DISABLED Codex task. Enable only after the live pilot is reviewed.
$ErrorActionPreference = 'Stop'
$crmRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$launcher = Join-Path $crmRoot 'win\konduktor-hidden.vbs'
$taskName = 'Leisson CRM konduktor'
$escape = { param($value) [System.Security.SecurityElement]::Escape([string]$value) }
$nodeXml = & $escape $nodePath
$launcherXml = & $escape $launcher
$rootXml = & $escape $crmRoot
$wscriptXml = & $escape (Join-Path ([Environment]::SystemDirectory) 'wscript.exe')
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$boundary = (Get-Date -Hour 8 -Minute 0 -Second 0).ToString('yyyy-MM-ddTHH:mm:ss')
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'Codex launcher missing' }
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Codex CRM: sync bodies, process refusals, plan and draft. No email sending.</Description></RegistrationInfo>
  <Triggers><CalendarTrigger><Repetition><Interval>PT30M</Interval><Duration>PT10H</Duration><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><StartBoundary>$boundary</StartBoundary><Enabled>true</Enabled><ScheduleByWeek><DaysOfWeek><Monday/><Tuesday/><Wednesday/><Thursday/><Friday/></DaysOfWeek><WeeksInterval>1</WeeksInterval></ScheduleByWeek></CalendarTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>$sid</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>false</StartWhenAvailable><Enabled>false</Enabled><Hidden>true</Hidden><ExecutionTimeLimit>PT70M</ExecutionTimeLimit></Settings>
  <Actions Context="Author"><Exec><Command>$wscriptXml</Command><Arguments>//B //Nologo &quot;$launcherXml&quot; &quot;$nodeXml&quot;</Arguments><WorkingDirectory>$rootXml</WorkingDirectory></Exec></Actions>
</Task>
"@
$dataDir = Join-Path $crmRoot 'data'
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
$previous = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($previous) {
  $backup = Join-Path $dataDir ('konduktor-before-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.xml')
  Export-ScheduledTask -TaskName $taskName | Set-Content -LiteralPath $backup -Encoding Unicode
}
Register-ScheduledTask -TaskName $taskName -Xml $xml -Force | Out-Null
Disable-ScheduledTask -TaskName $taskName | Out-Null
Write-Host 'Registered DISABLED. Weekdays 08:00-18:00, every 30 minutes. Enable after the reviewed pilot.'
Write-Host 'Native child processes are hidden; the sender tasks must remain disabled.'
