# Scratch probe: capture a narrow horizontal strip at the top of the browser window at high FPS.
# Usage: powershell -File strip-capture.ps1 -OutDir strip -Ms 6000
# NOTE: keep this file ASCII-only. Windows PowerShell 5.1 decodes .ps1 as ANSI (GBK on zh-CN)
# without a BOM, so non-ASCII comments can swallow a newline and break param parsing.
param(
  [string]$OutDir = 'strip',
  [int]$Ms = 6000,
  [string]$Title = '*DeepRead*',
  [int]$Y = 50,
  [int]$H = 400,
  [int]$Delay = 800,
  [int]$W = 0,
  [int]$AutoPop = 0
)
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type @'
using System;using System.Runtime.InteropServices;
public struct RECT{public int Left,Top,Right,Bottom;}
public static class W{
  [DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out RECT r);
  [DllImport("user32.dll")]public static extern bool SetProcessDPIAware();
}
'@
[void][W]::SetProcessDPIAware()

$root = (Get-Location).Path
$dir = Join-Path $root $OutDir
if (Test-Path $dir) { Remove-Item "$dir\*.png" -Force } else { New-Item -ItemType Directory -Path $dir | Out-Null }

Start-Sleep -Milliseconds $Delay

# 在多个候选窗口里挑"可见且面积最大"的那个：最小化的窗口 rect 是 -32000，必须跳过
$best = $null; $bestArea = 0; $bestR = $null
Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { ($_.MainWindowHandle -ne 0) -and ($_.MainWindowTitle -like $Title) } | ForEach-Object {
  $rr = New-Object RECT
  [void][W]::GetWindowRect($_.MainWindowHandle, [ref]$rr)
  $a = ($rr.Right - $rr.Left) * ($rr.Bottom - $rr.Top)
  if ($rr.Left -gt -1000 -and $rr.Top -gt -1000 -and $a -gt $bestArea) { $script:best = $_; $script:bestR = $rr; $script:bestArea = $a }
}
if (-not $best) { Write-Output "NO-WINDOW title=$Title"; exit 1 }
$r = $bestR
$winW = $r.Right - $r.Left
$y0 = $r.Top + $Y
$hh = [Math]::Min($H, $r.Bottom - $y0)
# $W > 0 -> narrow tile, centered horizontally. Smaller area = much higher FPS.
$ww = if ($W -gt 0) { $W } else { $winW }
$x0 = $r.Left + [Math]::Floor(($winW - $ww) / 2) + $AutoPop
Write-Output "window=$($r.Left),$($r.Top),$($winW)x$($r.Bottom-$r.Top) strip=(x$x0,y$y0) ${ww}x${hh}"
if ($hh -le 0 -or $ww -le 0) { Write-Output "BAD-RECT"; exit 2 }

$b = New-Object System.Drawing.Rectangle($x0, $y0, $ww, $hh)
$bmp = New-Object System.Drawing.Bitmap($ww, $hh, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$i = 0
while ($sw.ElapsedMilliseconds -lt $Ms) {
  $g.CopyFromScreen($b.X, $b.Y, 0, 0, $b.Size)
  $name = 's{0:d4}-{1:d5}ms.png' -f $i, $sw.ElapsedMilliseconds
  $bmp.Save((Join-Path $dir $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $i++
}
$g.Dispose(); $bmp.Dispose()
Write-Output "captured=$i frames=${winW}x${hh} span=$($sw.ElapsedMilliseconds)ms avg=$([Math]::Round($sw.ElapsedMilliseconds/[Math]::Max($i,1)))ms"
