[CmdletBinding()]
param(
    [string]$Destination = (Join-Path $env:USERPROFILE ".codex\skills\computer-use-studio-pro"),
    [string]$License,
    [string]$Revocations,
    [switch]$Agree,
    [switch]$Doctor
)

$ErrorActionPreference = "Stop"
$source = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$destinationFull = [System.IO.Path]::GetFullPath($Destination)
$parent = Split-Path -Parent $destinationFull
$name = Split-Path -Leaf $destinationFull
$pathRoot = [System.IO.Path]::GetPathRoot($destinationFull)
if ([string]::IsNullOrWhiteSpace($name) -or $destinationFull -eq $pathRoot) {
    throw "安装目标必须是具体的技能目录，而不是磁盘根目录"
}
if ($source -ne $destinationFull) {
    $separator = [System.IO.Path]::DirectorySeparatorChar
    $sourcePrefix = $source.TrimEnd($separator) + $separator
    $destinationPrefix = $destinationFull.TrimEnd($separator) + $separator
    if ($sourcePrefix.StartsWith($destinationPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
        $destinationPrefix.StartsWith($sourcePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "源目录与安装目标存在包含关系，请选择同级或独立目标目录"
    }
}
$staging = Join-Path $parent (".{0}.install-{1}" -f $name, [guid]::NewGuid().ToString("N"))
$backup = Join-Path $parent (".{0}.backup-{1}" -f $name, [guid]::NewGuid().ToString("N"))
$swapped = $false

try {
    if ($source -ne $destinationFull) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $staging -Recurse -Force
        if (Test-Path -LiteralPath $destinationFull) {
            Move-Item -LiteralPath $destinationFull -Destination $backup
        }
        Move-Item -LiteralPath $staging -Destination $destinationFull
        $swapped = $true
    }

    $scripts = Join-Path $destinationFull "adapters\codex\scripts"
    if ($Agree) {
        & node (Join-Path $scripts "agree_consent.mjs") "同意"
        if ($LASTEXITCODE -ne 0) { throw "协议确认命令执行失败" }
    }
    if ($License) {
        & node (Join-Path $scripts "manage_license.mjs") activate ([System.IO.Path]::GetFullPath($License))
        if ($LASTEXITCODE -ne 0) { throw "授权激活失败" }
    }
    if ($Revocations) {
        & node (Join-Path $scripts "manage_license.mjs") install-revocations ([System.IO.Path]::GetFullPath($Revocations))
        if ($LASTEXITCODE -ne 0) { throw "吊销清单安装失败" }
    }
    if ($Doctor) {
        & node (Join-Path $scripts "manage_license.mjs") doctor
        if ($LASTEXITCODE -ne 0) { throw "诊断发现待处理项目" }
    }

    if (Test-Path -LiteralPath $backup) {
        Remove-Item -LiteralPath $backup -Recurse -Force
    }
}
catch {
    if (Test-Path -LiteralPath $staging) {
        Remove-Item -LiteralPath $staging -Recurse -Force
    }
    if ($swapped -and (Test-Path -LiteralPath $destinationFull)) {
        Remove-Item -LiteralPath $destinationFull -Recurse -Force
    }
    if (Test-Path -LiteralPath $backup) {
        Move-Item -LiteralPath $backup -Destination $destinationFull
    }
    throw
}

[PSCustomObject]@{
    ok = $true
    installed = $destinationFull
    agreement_updated = [bool]$Agree
    license_installed = [bool]$License
    revocations_installed = [bool]$Revocations
}
