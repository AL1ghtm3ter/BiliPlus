param([switch]$SkipModelSetup)
$ErrorActionPreference = 'Stop'
$script:BiliPlusPackageRoot = $PSScriptRoot
. (Join-Path $PSScriptRoot 'scripts\bootstrap-node.ps1')

function Get-BiliPlusHostRegistrations {
  $keyPath = 'Software\Google\Chrome\NativeMessagingHosts\local.bilibili_codex'
  foreach ($view in @([Microsoft.Win32.RegistryView]::Registry32, [Microsoft.Win32.RegistryView]::Registry64)) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
    try {
      $key = $base.OpenSubKey($keyPath)
      if ($key) { try { [pscustomobject]@{ View=$view; Path=[string]$key.GetValue('') } } finally { $key.Dispose() } }
    } finally { $base.Dispose() }
  }
}
function Assert-BiliPlusHostOwnership {
  param([Parameter(Mandatory=$true)][string]$NativeManifest)
  $expected = [IO.Path]::GetFullPath($NativeManifest)
  foreach ($registration in @(Get-BiliPlusHostRegistrations)) {
    if (-not $registration.Path) { continue }
    if (-not [IO.Path]::IsPathRooted($registration.Path) -or -not [string]::Equals([IO.Path]::GetFullPath($registration.Path), $expected, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Another installation owns local.bilibili_codex. It was not changed: $($registration.Path)"
    }
  }
}
function Register-BiliPlusNativeHost {
  param([Parameter(Mandatory=$true)][string]$NativeManifest)
  Assert-BiliPlusHostOwnership -NativeManifest $NativeManifest
  $keyPath = 'Software\Google\Chrome\NativeMessagingHosts\local.bilibili_codex'
  foreach ($view in @([Microsoft.Win32.RegistryView]::Registry32, [Microsoft.Win32.RegistryView]::Registry64)) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
    try { $key = $base.CreateSubKey($keyPath); try { $key.SetValue('', $NativeManifest, [Microsoft.Win32.RegistryValueKind]::String) } finally { $key.Dispose() } } finally { $base.Dispose() }
  }
}
function Find-BiliPlusCodex {
  param($Previous)
  if ($Previous -and $Previous.codexPath -and (Test-Path -LiteralPath $Previous.codexPath -PathType Leaf)) { return [string]$Previous.codexPath }
  $command = Get-Command codex.exe -ErrorAction SilentlyContinue
  if ($command -and $command.Source) { return $command.Source }
  return $null
}
function Build-BiliPlusProgram {
  param([Parameter(Mandatory=$true)][string]$Source, [Parameter(Mandatory=$true)][string]$Destination)
  $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
  if (-not (Test-Path -LiteralPath $compiler)) { $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
  if (-not (Test-Path -LiteralPath $compiler)) { throw '.NET Framework C# compiler was not found. No native host configuration was replaced.' }
  & $compiler /nologo /target:winexe /optimize+ "/out:$Destination" $Source
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $Destination -PathType Leaf)) { throw 'Native host build failed. Existing configuration was not replaced.' }
}
function Build-BiliPlusLauncher {
  param([Parameter(Mandatory=$true)][string]$NativeRoot, [Parameter(Mandatory=$true)][string]$Destination)
  Build-BiliPlusProgram -Source (Join-Path $NativeRoot 'Launcher.cs') -Destination $Destination
}
function Build-BiliPlusRuntimeHost {
  param([Parameter(Mandatory=$true)][string]$NativeRoot, [Parameter(Mandatory=$true)][string]$Destination)
  Build-BiliPlusProgram -Source (Join-Path $NativeRoot 'RuntimeHost.cs') -Destination $Destination
}
function Invoke-BiliPlusModelSetup {
  param([Parameter(Mandatory=$true)][string]$NodePath, [Parameter(Mandatory=$true)][string]$PackageRoot)
  & $NodePath (Join-Path $PackageRoot 'native\setup-local.cjs') --model qwen3:4b
  if ($LASTEXITCODE -ne 0) { throw "Local text-model preparation did not finish (exit $LASTEXITCODE). The bridge is installed; rerun this script or use the model setup button in extension settings." }
}
function Install-BiliPlusBridge {
  param([string]$PackageRoot=$script:BiliPlusPackageRoot, [switch]$SkipModelSetup)
  $packageRoot = [IO.Path]::GetFullPath($PackageRoot)
  $nativeRoot = Assert-BiliPlusChildPath -Root $packageRoot -Path (Join-Path $packageRoot 'native')
  $nativeManifest = Assert-BiliPlusChildPath -Root $packageRoot -Path (Join-Path $nativeRoot 'local.bilibili_codex.json')
  # Both registry views are checked before downloading, compiling or writing installation files.
  Assert-BiliPlusHostOwnership -NativeManifest $nativeManifest
  $extensionId = (Get-Content -LiteralPath (Join-Path $packageRoot 'extension-id.txt') -Raw).Trim()
  if ($extensionId -notmatch '^[a-p]{32}$') { throw 'Invalid extension ID.' }
  if (-not (Test-Path -LiteralPath (Join-Path $nativeRoot 'Launcher.cs') -PathType Leaf)) { throw 'The package is incomplete: native/Launcher.cs is missing.' }
  if (-not (Test-Path -LiteralPath (Join-Path $nativeRoot 'RuntimeHost.cs') -PathType Leaf)) { throw 'The package is incomplete: native/RuntimeHost.cs is missing.' }
  Write-Host '小电视助手 · BiliPlus：安装当前用户的本机桥接，无需管理员或 Codex 账号。'
  $nodePath = Resolve-BiliPlusNode -PackageRoot $packageRoot
  $runtimeFile = Assert-BiliPlusChildPath -Root $packageRoot -Path (Join-Path $nativeRoot 'runtime.json')
  $previous = $null
  if (Test-Path -LiteralPath $runtimeFile -PathType Leaf) { try { $previous = Get-Content -LiteralPath $runtimeFile -Raw -Encoding UTF8 | ConvertFrom-Json } catch { throw 'The existing runtime.json is invalid. Back it up and repair it before reinstalling.' } }
  $config = @{ provider='local'; localModel='qwen3:4b'; extensionOrigin="chrome-extension://$extensionId/" }
  $codexPath = Find-BiliPlusCodex -Previous $previous
  if ($codexPath) {
    $config.codexPath = $codexPath
    $config.codexBinRoot = if ($previous -and $previous.codexBinRoot) { $previous.codexBinRoot } else { Split-Path (Split-Path $codexPath -Parent) -Parent }
  }
  $buildRoot = Assert-BiliPlusChildPath -Root $packageRoot -Path (Join-Path $packageRoot '.runtime\bridge-build')
  [void][IO.Directory]::CreateDirectory($buildRoot)
  $temporaryLauncher = Assert-BiliPlusChildPath -Root $packageRoot -Path (Join-Path $buildRoot ('BiliPlusHost-' + [Guid]::NewGuid().ToString('N') + '.exe'))
  $launcher = Assert-BiliPlusChildPath -Root $packageRoot -Path (Join-Path $nativeRoot 'BiliCodexHost.exe')
  $temporaryRuntimeHost = Assert-BiliPlusChildPath -Root $packageRoot -Path (Join-Path $buildRoot ('BiliPlusRuntime-' + [Guid]::NewGuid().ToString('N') + '.exe'))
  $runtimeHost = Assert-BiliPlusChildPath -Root $packageRoot -Path (Join-Path $nativeRoot 'RuntimeHost.exe')
  Build-BiliPlusLauncher -NativeRoot $nativeRoot -Destination $temporaryLauncher
  Build-BiliPlusRuntimeHost -NativeRoot $nativeRoot -Destination $temporaryRuntimeHost
  # Recheck after a potentially long download; never overwrite a newly claimed host.
  Assert-BiliPlusHostOwnership -NativeManifest $nativeManifest
  Copy-Item -LiteralPath $temporaryRuntimeHost -Destination $runtimeHost -Force
  Copy-Item -LiteralPath $temporaryLauncher -Destination $launcher -Force
  Remove-Item -LiteralPath $temporaryRuntimeHost
  Remove-Item -LiteralPath $temporaryLauncher
  $utf8 = New-Object Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($runtimeFile, ($config | ConvertTo-Json), $utf8)
  [IO.File]::WriteAllText((Assert-BiliPlusChildPath -Root $packageRoot -Path (Join-Path $nativeRoot 'node-path.txt')), $nodePath, $utf8)
  $definition = @{ name='local.bilibili_codex'; description='小电视助手 · BiliPlus 本机桥接'; path=$launcher; type='stdio'; allowed_origins=@("chrome-extension://$extensionId/") }
  [IO.File]::WriteAllText($nativeManifest, ($definition | ConvertTo-Json), $utf8)
  Register-BiliPlusNativeHost -NativeManifest $nativeManifest
  Write-Host '本机桥接已安装。扩展仍需在 Chrome 的 chrome://extensions 手动选择“加载已解压的扩展程序”：'
  Write-Host (Join-Path $packageRoot 'extension')
  Write-Host '默认使用本机 Qwen3 4B 文本模型，无需注册账号。首次模型下载约 2.5GB；已有模型会复用。'
  Write-Host '语音转写（ASR）仍是独立可选功能；文本模型准备成功不代表 ASR 已安装。'
  if ($SkipModelSetup) { Write-Host '已按 -SkipModelSetup 跳过模型准备；可稍后在扩展设置下载并配置。' }
  else { Invoke-BiliPlusModelSetup -NodePath $nodePath -PackageRoot $packageRoot }
}
if ($MyInvocation.InvocationName -ne '.') { Install-BiliPlusBridge -SkipModelSetup:$SkipModelSetup }
