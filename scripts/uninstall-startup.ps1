$startupDirectory =
  [Environment]::GetFolderPath("Startup")
$shortcutPath =
  Join-Path $startupDirectory "RG Recruitment Bot.lnk"

Remove-Item -LiteralPath $shortcutPath -Force `
  -ErrorAction SilentlyContinue

Write-Host "Startup shortcut removed."
