# Capture the README screenshots straight off a real Chromium, 480x480 -- the
# panel's physical resolution -- from the shipped bundle in dist/.
#
#   1. serve the repo root:  python dev/serve.py
#   2. pwsh dev/shots.ps1
#
# Writes docs/images/*.png. Chromium (not a mockup) so the pictures cannot drift
# from what the cards actually do.

$chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
$root   = Split-Path $PSScriptRoot -Parent
$out    = Join-Path $root "docs\images"
$base   = "http://localhost:8177/dev/bench.html"

New-Item -ItemType Directory -Force -Path $out | Out-Null

foreach ($shot in @("light", "cover", "sheet", "climate", "media", "info", "scenes", "alarm", "status", "sky")) {
  $file = Join-Path $out "$shot.png"
  if (Test-Path $file) { Remove-Item $file }
  $chromeArgs = @(
    "--headless", "--disable-gpu", "--hide-scrollbars",
    "--window-size=480,480", "--force-device-scale-factor=1",
    "--virtual-time-budget=6000",
    "--screenshot=$file", "$base`?shot=$shot"
  )
  Start-Process -FilePath $chrome -ArgumentList $chromeArgs -Wait -NoNewWindow
  if (Test-Path $file) { "wrote $file" } else { "FAILED $shot" }
}
