$ErrorActionPreference = 'Stop'
$nativeManifest = Join-Path $PSScriptRoot 'native\local.bilibili_codex.json'
foreach ($view in @([Microsoft.Win32.RegistryView]::Registry32, [Microsoft.Win32.RegistryView]::Registry64)) {
  $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
  $keyPath = 'Software\Google\Chrome\NativeMessagingHosts\local.bilibili_codex'
  $key = $base.OpenSubKey($keyPath)
  if ($key) {
    $value = $key.GetValue(''); $key.Dispose()
    if ($value -eq $nativeManifest) { $base.DeleteSubKey($keyPath, $false) }
  }
  $base.Dispose()
}
Write-Output 'Removed only this package native bridge registration. Files and Chrome extensions remain available.'
