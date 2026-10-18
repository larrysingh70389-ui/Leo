$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
$pm2Entrypoint = Join-Path $projectRoot 'node_modules\pm2\bin\pm2'
$taskName = 'Leonidas Visty Bot PM2 Resurrect'
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

if (-not (Test-Path $pm2Entrypoint)) {
  throw 'Local PM2 was not found. Run npm install in the project first.'
}

$action = New-ScheduledTaskAction `
  -Execute $nodeExecutable `
  -Argument "`"$pm2Entrypoint`" resurrect" `
  -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description 'Restore the saved Leonidas Discord bot PM2 process at user logon.' `
  -Force | Out-Null

Write-Output "Installed '$taskName' to restore PM2 at logon for $userId."