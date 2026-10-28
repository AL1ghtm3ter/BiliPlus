# Dot-sourcing defines functions only. No system PATH or machine settings are changed.
function Assert-BiliPlusChildPath {
  param([Parameter(Mandatory=$true)][string]$Root, [Parameter(Mandatory=$true)][string]$Path)
  $absoluteRoot = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  $absolutePath = [IO.Path]::GetFullPath($Path)
  if (-not $absolutePath.StartsWith($absoluteRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Path escapes the package directory: $absolutePath" }
  $cursor = $absolutePath
  while ($cursor -and $cursor.Length -gt $absoluteRoot.Length) {
    if (Test-Path -LiteralPath $cursor) {
      $item = Get-Item -LiteralPath $cursor -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Refusing a junction or symbolic link in the installation target: $cursor" }
    }
    $cursor = [IO.Path]::GetDirectoryName($cursor)
  }
  return $absolutePath
}
function Test-BiliPlusNodeRuntime {
  param([Parameter(Mandatory=$true)][string]$NodePath)
  if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { return $false }
  try { $version = & $NodePath --version 2>$null; return ($LASTEXITCODE -eq 0 -and [string]$version -match '^v(?:1[89]|[2-9][0-9])\.\d+\.\d+$') } catch { return $false }
}
function Find-BiliPlusSystemNode {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command -and $command.Source) { return $command.Source }
  return $null
}
function Get-BiliPlusNodeRelease {
  Write-Host '[Node 1/4] Reading the official Node.js 24 LTS checksum manifest...'
  $response = Invoke-WebRequest -Uri 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt' -UseBasicParsing -MaximumRedirection 0
  $content = [string]$response.Content
  if ($content.Length -gt 1048576) { throw 'The Node.js checksum manifest is unexpectedly large.' }
  $archiveMatches = [regex]::Matches($content, '(?m)^([a-fA-F0-9]{64})\s+(node-v(24\.\d+\.\d+)-win-x64\.zip)\s*$')
  if ($archiveMatches.Count -ne 1) { throw 'The official manifest does not identify exactly one Windows x64 Node.js 24 archive.' }
  return [pscustomobject]@{ Hash=$archiveMatches[0].Groups[1].Value.ToLowerInvariant(); FileName=$archiveMatches[0].Groups[2].Value; Version=$archiveMatches[0].Groups[3].Value; RootName=$archiveMatches[0].Groups[2].Value.Substring(0, $archiveMatches[0].Groups[2].Value.Length - 4); Uri=('https://nodejs.org/dist/latest-v24.x/' + $archiveMatches[0].Groups[2].Value) }
}
function Receive-BiliPlusNodeArchive {
  param([Parameter(Mandatory=$true)][string]$Uri, [Parameter(Mandatory=$true)][string]$Destination)
  $address = [Uri]$Uri
  if ($address.Scheme -ne 'https' -or $address.Host -ne 'nodejs.org' -or $address.UserInfo -or $address.Port -ne 443 -or $address.AbsolutePath -notmatch '^/dist/latest-v24\.x/node-v24\.\d+\.\d+-win-x64\.zip$') { throw 'Node.js archives must come directly from the official nodejs.org Node 24 distribution.' }
  Write-Host '[Node 2/4] Downloading the official Windows x64 portable ZIP (Ctrl+C cancels)...'
  Invoke-WebRequest -Uri $address.AbsoluteUri -OutFile $Destination -UseBasicParsing -MaximumRedirection 0
}
function Get-BiliPlusSafeZipTargets {
  param([Parameter(Mandatory=$true)][object[]]$Entries, [Parameter(Mandatory=$true)][string]$Destination, [Parameter(Mandatory=$true)][string]$ExpectedRoot)
  if ($ExpectedRoot -notmatch '^node-v24\.\d+\.\d+-win-x64$') { throw 'Invalid Node.js archive root.' }
  if ($Entries.Count -gt 50000) { throw 'The Node.js archive contains too many entries.' }
  $targets = @(); $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase); $totalBytes = 0L
  foreach ($entry in $Entries) {
    $name = ([string]$entry.FullName).Replace('\', '/'); $parts = $name.Split('/')
    if (-not $name -or $name.StartsWith('/') -or $name.Contains(':') -or $name.IndexOf([char]0) -ge 0 -or $parts -contains '..' -or $parts -contains '.' -or $parts[0] -ne $ExpectedRoot) { throw "Unsafe path in Node.js ZIP: $name" }
    if (($entry.ExternalAttributes -shr 16 -band 0xF000) -eq 0xA000 -or ($entry.ExternalAttributes -band 0x400) -ne 0) { throw "Links are not permitted in the Node.js ZIP: $name" }
    $target = Assert-BiliPlusChildPath -Root $Destination -Path (Join-Path $Destination ($name.Replace('/', [IO.Path]::DirectorySeparatorChar)))
    if (-not $seen.Add($target.TrimEnd([IO.Path]::DirectorySeparatorChar))) { throw "Duplicate path in Node.js ZIP: $name" }
    $totalBytes += [long]$entry.Length
    if ($totalBytes -gt 2147483648L -or [long]$entry.Length -gt 536870912L) { throw 'The unpacked Node.js archive exceeds its size limit.' }
    $targets += [pscustomobject]@{ Entry=$entry; Path=$target; Directory=($name.EndsWith('/')) }
  }
  if (-not ($targets | Where-Object { -not $_.Directory -and $_.Path -eq (Join-Path (Join-Path $Destination $ExpectedRoot) 'node.exe') })) { throw 'The Node.js ZIP does not contain its expected node.exe.' }
  return $targets
}
function Expand-BiliPlusNodeArchive {
  param([Parameter(Mandatory=$true)][string]$Archive, [Parameter(Mandatory=$true)][string]$Destination, [Parameter(Mandatory=$true)][string]$ExpectedRoot)
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
  try {
    # Validate every path before creating any extracted file.
    $targets = @(Get-BiliPlusSafeZipTargets -Entries @($zip.Entries) -Destination $Destination -ExpectedRoot $ExpectedRoot)
    foreach ($target in $targets) {
      if ($target.Directory) { [void][IO.Directory]::CreateDirectory($target.Path); continue }
      [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target.Path))
      $source = $target.Entry.Open()
      try { $output = New-Object IO.FileStream($target.Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write); try { $source.CopyTo($output) } finally { $output.Dispose() } } finally { $source.Dispose() }
    }
  } finally { $zip.Dispose() }
}
function Get-BiliPlusFileSha256 {
  param([Parameter(Mandatory=$true)][string]$LiteralPath)
  $stream = [IO.File]::OpenRead($LiteralPath)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
  finally { $algorithm.Dispose(); $stream.Dispose() }
}
function Install-BiliPlusPortableNode {
  param([Parameter(Mandatory=$true)][string]$PackageRoot)
  $runtimeRoot = Assert-BiliPlusChildPath -Root $PackageRoot -Path (Join-Path $PackageRoot '.runtime\node')
  [void][IO.Directory]::CreateDirectory($runtimeRoot)
  $release = Get-BiliPlusNodeRelease
  $installation = Assert-BiliPlusChildPath -Root $runtimeRoot -Path (Join-Path $runtimeRoot ('runtime-' + [Guid]::NewGuid().ToString('N')))
  [void][IO.Directory]::CreateDirectory($installation)
  $archive = Assert-BiliPlusChildPath -Root $installation -Path (Join-Path $installation $release.FileName)
  Receive-BiliPlusNodeArchive -Uri $release.Uri -Destination $archive
  Write-Host '[Node 3/4] Verifying SHA256 before extraction...'
  $actualHash = Get-BiliPlusFileSha256 -LiteralPath $archive
  if (-not [string]::Equals($actualHash, $release.Hash, [StringComparison]::OrdinalIgnoreCase)) { throw 'Node.js ZIP SHA256 does not match the official checksum. Nothing was extracted.' }
  $extracted = Assert-BiliPlusChildPath -Root $installation -Path (Join-Path $installation 'files')
  Expand-BiliPlusNodeArchive -Archive $archive -Destination $extracted -ExpectedRoot $release.RootName
  $nodePath = Assert-BiliPlusChildPath -Root $runtimeRoot -Path (Join-Path (Join-Path $extracted $release.RootName) 'node.exe')
  if (-not (Test-BiliPlusNodeRuntime -NodePath $nodePath)) { throw 'The verified portable Node.js executable did not start correctly.' }
  [IO.File]::WriteAllText((Join-Path $runtimeRoot 'selected-node.txt'), $nodePath, (New-Object Text.UTF8Encoding($false)))
  Write-Host '[Node 4/4] Portable Node.js is ready inside this package; system PATH was not changed.'
  return $nodePath
}
function Resolve-BiliPlusNode {
  param([Parameter(Mandatory=$true)][string]$PackageRoot)
  $systemNode = Find-BiliPlusSystemNode
  if ($systemNode) {
    if (-not (Test-BiliPlusNodeRuntime -NodePath $systemNode)) { throw 'The existing node.exe cannot run this bridge. Node.js 18 or newer is required; update Node.js and retry.' }
    Write-Host "[Node] Reusing the existing runtime: $systemNode"
    return [IO.Path]::GetFullPath($systemNode)
  }
  $runtimeRoot = Assert-BiliPlusChildPath -Root $PackageRoot -Path (Join-Path $PackageRoot '.runtime\node')
  $selection = Join-Path $runtimeRoot 'selected-node.txt'
  if (Test-Path -LiteralPath $selection -PathType Leaf) {
    $cached = Assert-BiliPlusChildPath -Root $runtimeRoot -Path ((Get-Content -LiteralPath $selection -Raw -Encoding UTF8).Trim())
    if (Test-BiliPlusNodeRuntime -NodePath $cached) { Write-Host '[Node] Reusing this package portable runtime.'; return $cached }
  }
  return Install-BiliPlusPortableNode -PackageRoot $PackageRoot
}
