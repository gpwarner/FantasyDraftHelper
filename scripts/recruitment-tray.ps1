Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent $PSScriptRoot
$dataDirectory = Join-Path $repoRoot "data"
$logFile = Join-Path $dataDirectory "recruitment-bot.log"
$pidFile = Join-Path $dataDirectory "tray-bot.pid"

New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null

$script:botProcess = $null
$script:isQuitting = $false
$script:autoRestartAt = $null
$script:restartAttempt = 0
$script:botStartedAt = $null

$autoRestartInitialDelaySeconds = 5
$autoRestartMaximumDelaySeconds = 300
$autoRestartResetAfterSeconds = 60

function Test-BotRunning {
  if ($null -eq $script:botProcess) {
    return $false
  }

  try {
    return -not $script:botProcess.HasExited
  }
  catch {
    return $false
  }
}

function Update-TrayStatus {
  $running = Test-BotRunning
  $startItem.Enabled = -not $running
  $stopItem.Enabled = $running
  $restartItem.Enabled = $running
  $notifyIcon.Text = if ($running) {
    "RG Recruitment Bot - Running"
  }
  else {
    "RG Recruitment Bot - Stopped"
  }
}

function Show-TrayMessage {
  param(
    [string]$Title,
    [string]$Message,
    [System.Windows.Forms.ToolTipIcon]$Icon =
      [System.Windows.Forms.ToolTipIcon]::Info
  )

  $notifyIcon.ShowBalloonTip(
    3000,
    $Title,
    $Message,
    $Icon
  )
}

function Schedule-AutomaticRestart {
  if ($script:isQuitting) {
    return
  }

  $script:restartAttempt++

  $exponent = [Math]::Min(
    $script:restartAttempt - 1,
    10
  )
  $delaySeconds = [int][Math]::Min(
    $autoRestartMaximumDelaySeconds,
    $autoRestartInitialDelaySeconds *
      [Math]::Pow(2, $exponent)
  )

  $script:autoRestartAt =
    [DateTime]::UtcNow.AddSeconds($delaySeconds)

  Show-TrayMessage `
    "RG Recruitment Bot" `
    "The bot stopped unexpectedly. Restarting in $delaySeconds seconds." `
    ([System.Windows.Forms.ToolTipIcon]::Warning)
}

function Start-RecruitmentBot {
  param([switch]$Automatic)

  if (Test-BotRunning) {
    return
  }

  if (-not $Automatic) {
    $script:autoRestartAt = $null
    $script:restartAttempt = 0
  }

  $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue

  if ($null -eq $npmCommand) {
    Show-TrayMessage `
      "RG Recruitment Bot" `
      "npm.cmd was not found. Install Node.js or add it to PATH." `
      ([System.Windows.Forms.ToolTipIcon]::Error)

    if ($Automatic) {
      Schedule-AutomaticRestart
    }

    return
  }

  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -LiteralPath $logFile -Value `
    "`r`n[$timestamp] Starting RG Recruitment Bot..."

  $command = @(
    "cd /d `"$repoRoot`""
    "`"$($npmCommand.Source)`" run start >> `"$logFile`" 2>&1"
  ) -join " && "

  $startInfo =
    [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $env:ComSpec
  $startInfo.Arguments = "/d /s /c `"$command`""
  $startInfo.WorkingDirectory = $repoRoot
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.WindowStyle =
    [System.Diagnostics.ProcessWindowStyle]::Hidden

  try {
    $script:botProcess =
      [System.Diagnostics.Process]::Start($startInfo)
    $script:autoRestartAt = $null
    $script:botStartedAt =
      [DateTime]::UtcNow
    Set-Content -LiteralPath $pidFile -Value `
      $script:botProcess.Id -NoNewline
    Update-TrayStatus
    Show-TrayMessage `
      "RG Recruitment Bot" `
      $(if ($Automatic) {
        "The bot restarted automatically and is running."
      }
      else {
        "The bot is running in the background."
      })
  }
  catch {
    $script:botProcess = $null
    $script:botStartedAt = $null
    Update-TrayStatus

    if ($Automatic) {
      Schedule-AutomaticRestart
    }
    else {
      Show-TrayMessage `
        "RG Recruitment Bot" `
        "The bot could not start. Check the log for details." `
        ([System.Windows.Forms.ToolTipIcon]::Error)
    }
  }
}

function Stop-RecruitmentBot {
  param([switch]$Quiet)

  $script:autoRestartAt = $null
  $script:restartAttempt = 0
  $script:botStartedAt = $null

  if (-not (Test-BotRunning)) {
    $script:botProcess = $null
    Remove-Item -LiteralPath $pidFile -Force `
      -ErrorAction SilentlyContinue
    Update-TrayStatus
    return
  }

  & "$env:SystemRoot\System32\taskkill.exe" `
    /PID $script:botProcess.Id /T /F 2>&1 | Out-Null
  $script:botProcess = $null
  Remove-Item -LiteralPath $pidFile -Force `
    -ErrorAction SilentlyContinue
  Update-TrayStatus

  if (-not $Quiet) {
    Show-TrayMessage `
      "RG Recruitment Bot" `
      "The bot has stopped."
  }
}

function Open-BotLog {
  if (-not (Test-Path -LiteralPath $logFile)) {
    New-Item -ItemType File -Path $logFile -Force |
      Out-Null
  }

  Start-Process notepad.exe -ArgumentList `
    "`"$logFile`""
}

$contextMenu =
  [System.Windows.Forms.ContextMenuStrip]::new()
$startItem = $contextMenu.Items.Add("Start bot")
$stopItem = $contextMenu.Items.Add("Stop bot")
$restartItem = $contextMenu.Items.Add("Restart bot")
$null = $contextMenu.Items.Add(
  [System.Windows.Forms.ToolStripSeparator]::new()
)
$logItem = $contextMenu.Items.Add("Open log")
$null = $contextMenu.Items.Add(
  [System.Windows.Forms.ToolStripSeparator]::new()
)
$quitItem = $contextMenu.Items.Add("Quit")

$notifyIcon =
  [System.Windows.Forms.NotifyIcon]::new()
$notifyIcon.Icon =
  [System.Drawing.SystemIcons]::Application
$notifyIcon.ContextMenuStrip = $contextMenu
$notifyIcon.Visible = $true

$startItem.Add_Click({
  Start-RecruitmentBot
})
$stopItem.Add_Click({
  Stop-RecruitmentBot
})
$restartItem.Add_Click({
  Stop-RecruitmentBot -Quiet
  Start-RecruitmentBot
})
$logItem.Add_Click({
  Open-BotLog
})
$notifyIcon.Add_DoubleClick({
  Open-BotLog
})
$quitItem.Add_Click({
  $script:isQuitting = $true
  Stop-RecruitmentBot -Quiet
  $notifyIcon.Visible = $false
  $notifyIcon.Dispose()
  $contextMenu.Dispose()
  [System.Windows.Forms.Application]::Exit()
})

$statusTimer =
  [System.Windows.Forms.Timer]::new()
$statusTimer.Interval = 2000
$statusTimer.Add_Tick({
  if (
    (Test-BotRunning) -and
    $script:restartAttempt -gt 0 -and
    $null -ne $script:botStartedAt -and
    ([DateTime]::UtcNow -
      $script:botStartedAt).TotalSeconds -ge
        $autoRestartResetAfterSeconds
  ) {
    $script:restartAttempt = 0
  }

  if (
    $null -ne $script:botProcess -and
    -not (Test-BotRunning)
  ) {
    $exitCode =
      $script:botProcess.ExitCode
    $timestamp =
      Get-Date -Format "yyyy-MM-dd HH:mm:ss"

    Add-Content -LiteralPath $logFile -Value `
      "[$timestamp] Bot process exited with code $exitCode."

    $script:botProcess = $null
    $script:botStartedAt = $null
    Remove-Item -LiteralPath $pidFile -Force `
      -ErrorAction SilentlyContinue
    Update-TrayStatus

    if (-not $script:isQuitting) {
      Schedule-AutomaticRestart
    }
  }

  if (
    $null -ne $script:autoRestartAt -and
    -not (Test-BotRunning) -and
    [DateTime]::UtcNow -ge
      $script:autoRestartAt
  ) {
    $script:autoRestartAt = $null
    Start-RecruitmentBot -Automatic
  }
})
$statusTimer.Start()

Update-TrayStatus
Start-RecruitmentBot
[System.Windows.Forms.Application]::Run()
