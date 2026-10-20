# คัดลอกไฟล์ที่ใช้ร่วมกัน (web/core.js, web/seed.js) ไปเป็น Core.gs / Seed.gs สำหรับ Apps Script
# รันทุกครั้งหลังแก้ core.js หรือ seed.js:  powershell -File tools\sync-gas.ps1
$root = Split-Path -Parent $PSScriptRoot
Copy-Item "$root\web\core.js" "$root\apps-script\Core.gs" -Force
Copy-Item "$root\web\seed.js" "$root\apps-script\Seed.gs" -Force
Write-Host "Synced Core.gs and Seed.gs"
