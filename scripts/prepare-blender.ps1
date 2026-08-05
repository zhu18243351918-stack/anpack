$ErrorActionPreference = 'Stop'
$version = '4.5.12'
$expected = '317ef64e7a2c3cc79ec810c766ae9828aff865bea78039dc695b3f1118c34b4f'
$url = "https://download.blender.org/release/Blender4.5/blender-$version-windows-x64.zip"
$zip = Join-Path $PSScriptRoot 'blender.zip'
$unpack = Join-Path $PSScriptRoot 'blender-unpacked'
$target = Join-Path (Split-Path $PSScriptRoot) 'src-tauri\resources\blender'
Invoke-WebRequest $url -OutFile $zip
if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne $expected) { throw 'Blender SHA-256 mismatch' }
Remove-Item $unpack -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive $zip $unpack
Remove-Item $target -Recurse -Force -ErrorAction SilentlyContinue
New-Item $target -ItemType Directory -Force | Out-Null
Copy-Item "$unpack\blender-$version-windows-x64\*" $target -Recurse -Force
Write-Host "Blender $version is ready at $target"
