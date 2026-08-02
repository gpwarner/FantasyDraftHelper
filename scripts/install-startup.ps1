$repoRoot = Split-Path -Parent $PSScriptRoot
$launcherPath =
  Join-Path $repoRoot "Start RGRecruitment Tray.vbs"
$startupDirectory =
  [Environment]::GetFolderPath("Startup")
$shortcutPath =
  Join-Path $startupDirectory "RG Recruitment Bot.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath =
  "$env:SystemRoot\System32\wscript.exe"
$shortcut.Arguments = "`"$launcherPath`""
$shortcut.WorkingDirectory = $repoRoot
$shortcut.Description =
  "Start the RG Recruitment Discord bot in the system tray"
$shortcut.IconLocation =
  "$env:SystemRoot\System32\shell32.dll,220"
$shortcut.Save()

Write-Host "Startup shortcut installed:"
Write-Host $shortcutPath
