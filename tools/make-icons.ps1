# สร้างไอคอน PNG (192/512 + maskable) สำหรับติดตั้งแอปบน Android
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot

function New-Icon([int]$size, [string]$path, [bool]$maskable) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $green = [System.Drawing.Color]::FromArgb(20, 83, 45)
  $gold = [System.Drawing.Color]::FromArgb(224, 180, 74)
  $ring = [System.Drawing.Color]::FromArgb(168, 123, 28)
  $s = $size / 512.0

  if ($maskable) {
    $g.Clear($green)
    $scale = 0.78   # เว้นขอบ safe zone ของ maskable icon
  } else {
    $g.Clear([System.Drawing.Color]::Transparent)
    $r = 112 * $s; $d = $r * 2
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddArc(0, 0, $d, $d, 180, 90); $p.AddArc($size - $d, 0, $d, $d, 270, 90)
    $p.AddArc($size - $d, $size - $d, $d, $d, 0, 90); $p.AddArc(0, $size - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    $g.FillPath((New-Object System.Drawing.SolidBrush $green), $p)
    $scale = 1.0
  }
  $c = $size / 2.0
  $r1 = 168 * $s * $scale
  $g.FillEllipse((New-Object System.Drawing.SolidBrush $gold), $c - $r1, $c - $r1, $r1 * 2, $r1 * 2)
  $r2 = 136 * $s * $scale
  $pen = New-Object System.Drawing.Pen $ring, (14 * $s * $scale)
  $g.DrawEllipse($pen, $c - $r2, $c - $r2, $r2 * 2, $r2 * 2)
  $font = New-Object System.Drawing.Font 'Tahoma', (150 * $s * $scale), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
  $g.DrawString([string][char]0x0E3F, $font, (New-Object System.Drawing.SolidBrush $green), (New-Object System.Drawing.RectangleF 0, (6 * $s), $size, $size), $fmt)
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

New-Icon 192 "$root\web\icons\icon-192.png" $false
New-Icon 512 "$root\web\icons\icon-512.png" $false
New-Icon 512 "$root\web\icons\icon-maskable-512.png" $true
Write-Host "Icons written"
