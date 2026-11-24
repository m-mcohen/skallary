# Skallary launcher: the target of the "Skallary" Start menu shortcut.
# If the server already answers on its port, open the app in the browser.
# Otherwise start run.bat minimized; the server opens the browser itself once it listens.
# If the running server identifies itself as the sample, show a message and stop.
# If the sample check fails, open the running app so older versions still work.
$ErrorActionPreference = "SilentlyContinue"
$url = "http://127.0.0.1:4321"
$running = $false
try {
    $r = Invoke-WebRequest -Uri "$url/api/simplefin/status" -UseBasicParsing -TimeoutSec 3
    $running = $r.StatusCode -eq 200
} catch {}
if ($running) {
    $sample = $false
    try { $sample = (Invoke-RestMethod -Uri "$url/api/instance" -TimeoutSec 3).sample -eq $true } catch {}
    if (-not $sample) {
        # The running app opens its own window in the browser saved in Settings.
        # If that request fails, open the app in Microsoft Edge with the default profile.
        try { Invoke-RestMethod -Method Post -Uri "$url/api/open-window" -TimeoutSec 5 | Out-Null }
        catch { Start-Process msedge -ArgumentList "--profile-directory=Default", "--app=$url" }
    } else {
        $note = "The sample app is answering on your app's port, so nothing was opened. Close it and start the app again."
        (New-Object -ComObject WScript.Shell).Popup($note, 0, "Skallary", 48) | Out-Null
    }
} else {
    Start-Process -FilePath (Join-Path (Split-Path -Parent $PSScriptRoot) "run.bat") -WindowStyle Minimized
}
