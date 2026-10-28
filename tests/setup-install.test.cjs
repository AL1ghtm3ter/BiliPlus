"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  { spawnSync } = require("node:child_process"),
  { EventEmitter } = require("node:events");
const root = path.resolve(
    process.env.BILI_TEST_SOURCE_ROOT || path.join(__dirname, ".."),
  ),
  setup = require(path.join(root, "native/setup-local.cjs"));
const powershell = path.join(
  process.env.WINDIR || "C:/Windows",
  "System32/WindowsPowerShell/v1.0/powershell.exe",
);
const psAvailable = process.platform === "win32" && fs.existsSync(powershell);
function ps(body, options = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "biliplus-setup-test-")),
    pkg = path.join(base, "package");
  fs.mkdirSync(path.join(pkg, "native"), { recursive: true });
  fs.writeFileSync(path.join(pkg, "extension-id.txt"), "a".repeat(32));
  fs.writeFileSync(path.join(pkg, "native/Launcher.cs"), "fixture source");
  fs.writeFileSync(
    path.join(pkg, "native/RuntimeHost.cs"),
    "fixture runtime source",
  );
  const info = {
    // Exercise valid path aliases independently of Join-Path's normalization,
    // which differs between Windows PowerShell/.NET builds on local and CI.
    packageRoot:
      options.pathStyle === "mixed-dot" ? pkg.replace(/\\/g, "/") + "/." : pkg,
    installerPath: path.join(root, "安装本机桥接.ps1"),
    bootstrapPath: path.join(root, "scripts/bootstrap-node.ps1"),
    nodePath: process.execPath,
    base,
  };
  fs.writeFileSync(path.join(base, "input.json"), JSON.stringify(info));
  const header = `$ErrorActionPreference='Stop'\n[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)\n$data=Get-Content -LiteralPath $env:BILIPLUS_SETUP_TEST_DATA -Raw -Encoding UTF8 | ConvertFrom-Json\n. $data.installerPath\nfunction Assert-Test { param($Condition,[string]$Message) if(-not $Condition){throw $Message} }\nfunction Get-BiliPlusHostRegistrations { return @() }\nfunction Register-BiliPlusNativeHost { param($NativeManifest) $script:registered=$NativeManifest }\nfunction Resolve-BiliPlusNode { param($PackageRoot) return $data.nodePath }\nfunction Build-BiliPlusLauncher { param($NativeRoot,$Destination) [IO.File]::WriteAllText($Destination,'fixture launcher') }\nfunction Find-BiliPlusCodex { param($Previous) return $null }\nfunction Invoke-BiliPlusModelSetup { param($NodePath,$PackageRoot) $script:modelCalls++ }\n$script:modelCalls=0\n`;
  fs.writeFileSync(
    path.join(base, "test.ps1"),
    "\ufeff" +
      header +
      "function Build-BiliPlusRuntimeHost { param($NativeRoot,$Destination) [IO.File]::WriteAllText($Destination,'fixture runtime host') }\n" +
      body +
      "\nWrite-Output 'QA_SETUP_PASS'\n",
  );
  let result;
  try {
    result = spawnSync(
      powershell,
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(base, "test.ps1"),
      ],
      {
        env: {
          ...process.env,
          BILIPLUS_SETUP_TEST_DATA: path.join(base, "input.json"),
        },
        encoding: "utf8",
        windowsHide: true,
        timeout: 20000,
        maxBuffer: 1024 * 1024,
      },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
    assert(result.stdout.includes("QA_SETUP_PASS"));
    return result.stdout;
  } finally {
    const absolute = path.resolve(base),
      parent = path.resolve(os.tmpdir());
    assert(
      absolute.startsWith(parent + path.sep) &&
        path.basename(absolute).startsWith("biliplus-setup-test-"),
    );
    fs.rmSync(absolute, { recursive: true, force: true });
  }
}
test(
  "plain bridge installation does not prepare a model, and conflicting setup switches fail before writes",
  { skip: !psAvailable },
  () => {
    ps(`Install-BiliPlusBridge -PackageRoot $data.packageRoot
Assert-Test ($script:modelCalls -eq 0) 'plain install prepared a model'
Assert-Test (Test-Path -LiteralPath (Join-Path $data.packageRoot 'native/runtime.json')) 'bridge was not installed'`);
    ps(`$caught=$false
try { Install-BiliPlusBridge -PackageRoot $data.packageRoot -PrepareModel -SkipModelSetup } catch { $caught=$true }
Assert-Test $caught 'conflicting switches accepted'
Assert-Test (-not(Test-Path -LiteralPath (Join-Path $data.packageRoot 'native/runtime.json'))) 'conflict wrote config'
Assert-Test ($script:modelCalls -eq 0) 'conflict prepared a model'`);
  },
);

test("installer contract makes model setup opt-in without login or global PATH changes", () => {
  const source = fs.readFileSync(path.join(root, "安装本机桥接.ps1"), "utf8"),
    bootstrap = fs.readFileSync(
      path.join(root, "scripts/bootstrap-node.ps1"),
      "utf8",
    );
  assert(
    source.includes("param([switch]$PrepareModel, [switch]$SkipModelSetup)"),
  );
  assert(source.includes("provider='local'"));
  assert(source.includes("localModel='qwen3:4b'"));
  assert(
    !/login\s+status|Get-Command codex\.exe -ErrorAction Stop/.test(source),
  );
  assert(
    !/SetEnvironmentVariable|\$env:(?:PATH|OLLAMA_\w+)\s*=|Invoke-Expression|\biex\b/i.test(
      source + bootstrap,
    ),
  );
  assert(
    bootstrap.includes("https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt"),
  );
  assert(bootstrap.includes("Get-BiliPlusFileSha256 -LiteralPath $archive"));
  assert(source.includes("语音转写（ASR）仍是独立可选功能"));
});
test(
  "PowerShell modules parse and dot-source without installing or registering",
  { skip: !psAvailable },
  () => {
    ps(
      `Assert-Test ((Get-Command Install-BiliPlusBridge).CommandType -eq 'Function') 'installer function missing'\nAssert-Test (-not(Test-Path -LiteralPath (Join-Path $data.packageRoot 'native/runtime.json'))) 'dot source mutated package'\nAssert-Test ($script:modelCalls -eq 0) 'dot source prepared a model'`,
    );
  },
);
test(
  "a conflicting owner in either registry view blocks Node, builds and configuration writes first",
  { skip: !psAvailable },
  () => {
    ps(
      `$script:nodeCalls=0\nfunction Resolve-BiliPlusNode {param($PackageRoot) $script:nodeCalls++;throw 'must not run'}\nfunction Get-BiliPlusHostRegistrations { @([pscustomobject]@{View='32';Path=(Join-Path $data.packageRoot 'native/local.bilibili_codex.json')},[pscustomobject]@{View='64';Path=(Join-Path $data.base 'other/native.json')}) }\n$caught=$false;try{Install-BiliPlusBridge -PackageRoot $data.packageRoot -SkipModelSetup}catch{$caught=$_.Exception.Message -like '*Another installation owns*'}\nAssert-Test $caught 'conflicting owner not rejected'\nAssert-Test ($script:nodeCalls -eq 0) 'Node was resolved before ownership gate'\nAssert-Test (-not(Test-Path -LiteralPath (Join-Path $data.packageRoot 'native/runtime.json'))) 'runtime overwritten'\nAssert-Test (-not(Test-Path -LiteralPath (Join-Path $data.packageRoot '.runtime'))) 'installation files created before owner gate'`,
    );
  },
);
test(
  "no-Codex installation writes local config and can skip model setup",
  { skip: !psAvailable },
  () => {
    for (const pathStyle of ["canonical", "mixed-dot"])
      ps(
        `Install-BiliPlusBridge -PackageRoot $data.packageRoot -SkipModelSetup\n$config=Get-Content -LiteralPath (Join-Path $data.packageRoot 'native/runtime.json') -Raw | ConvertFrom-Json\nAssert-Test ($config.provider -eq 'local' -and $config.localModel -eq 'qwen3:4b') 'local config missing'\nAssert-Test (-not $config.codexPath) 'Codex path unexpectedly required'\nAssert-Test ($script:modelCalls -eq 0) 'SkipModelSetup ignored'\n$expectedManifest=[IO.Path]::GetFullPath((Join-Path $data.packageRoot 'native/local.bilibili_codex.json'))\n$actualManifest=[IO.Path]::GetFullPath($script:registered)\nAssert-Test ([string]::Equals($actualManifest,$expectedManifest,[StringComparison]::OrdinalIgnoreCase)) ('wrong host registration: expected '+$expectedManifest+'; received '+$actualManifest)\n$manifest=Get-Content -LiteralPath $script:registered -Raw | ConvertFrom-Json\nAssert-Test ($manifest.allowed_origins[0] -eq ('chrome-extension://' + ('a'*32) + '/')) 'wrong origin'`,
        { pathStyle },
      );
  },
);
test(
  "explicit model preparation preserves optional existing Codex path",
  { skip: !psAvailable },
  () => {
    ps(
      `$optional=Join-Path $data.packageRoot '中文可选-codex.exe';[IO.File]::WriteAllText($optional,'not executed')\n[IO.File]::WriteAllText((Join-Path $data.packageRoot 'native/runtime.json'),(@{codexPath=$optional;codexBinRoot=$data.packageRoot}|ConvertTo-Json))\nRemove-Item Function:Find-BiliPlusCodex\n# Restore the real optional path discovery without invoking a login command.\n. $data.installerPath\nfunction Get-BiliPlusHostRegistrations{return @()}\nfunction Register-BiliPlusNativeHost{param($NativeManifest)$script:registered=$NativeManifest}\nfunction Resolve-BiliPlusNode{param($PackageRoot)return $data.nodePath}\nfunction Build-BiliPlusLauncher{param($NativeRoot,$Destination)[IO.File]::WriteAllText($Destination,'fixture launcher')}\nfunction Build-BiliPlusRuntimeHost{param($NativeRoot,$Destination)[IO.File]::WriteAllText($Destination,'fixture runtime host')}\nfunction Invoke-BiliPlusModelSetup{param($NodePath,$PackageRoot)$script:modelCalls++}\nInstall-BiliPlusBridge -PackageRoot $data.packageRoot -PrepareModel\n$config=Get-Content -LiteralPath (Join-Path $data.packageRoot 'native/runtime.json') -Raw -Encoding UTF8|ConvertFrom-Json\nAssert-Test ($script:modelCalls -eq 1) 'first install did not prepare model'\nAssert-Test ($config.provider -eq 'local' -and $config.codexPath -eq $optional) 'optional Codex configuration lost'`,
    );
  },
);
test(
  "build failure and ownership changes after download preserve existing package config and launcher",
  { skip: !psAvailable },
  () => {
    for (const mode of ["build", "owner"]) {
      ps(
        `$runtime=Join-Path $data.packageRoot 'native/runtime.json';$launcher=Join-Path $data.packageRoot 'native/BiliCodexHost.exe'\n[IO.File]::WriteAllText($runtime,'{"provider":"local","localModel":"qwen3:4b"}');[IO.File]::WriteAllText($launcher,'old launcher')\n$before=[IO.File]::ReadAllText($runtime)\n${mode === "build" ? "function Build-BiliPlusLauncher {param($NativeRoot,$Destination)throw 'QA compiler failed'}" : "$script:checks=0;function Get-BiliPlusHostRegistrations{$script:checks++;if($script:checks -gt 1){[pscustomobject]@{Path=(Join-Path $data.base 'new-owner.json')}}}"}\n$caught=$false;try{Install-BiliPlusBridge -PackageRoot $data.packageRoot -SkipModelSetup}catch{$caught=$true}\nAssert-Test $caught 'failure was not surfaced'\nAssert-Test ([IO.File]::ReadAllText($runtime) -eq $before) 'runtime changed despite pre-commit failure'\nAssert-Test ([IO.File]::ReadAllText($launcher) -eq 'old launcher') 'launcher changed despite pre-commit failure'`,
      );
    }
  },
);
test(
  "portable Node ZIP validator rejects traversal, rooted paths, ADS, symlinks and case-colliding entries before extraction",
  { skip: !psAvailable },
  () => {
    ps(
      `. $data.bootstrapPath\n$rootName='node-v24.99.0-win-x64';$dest=Join-Path $data.packageRoot 'sandbox'\n$valid=[pscustomobject]@{FullName=($rootName+'/node.exe');Length=10;ExternalAttributes=0}\nforeach($badName in @($rootName+'/../../outside.exe','/absolute.exe','C:/absolute.exe',$rootName+'/node.exe:payload','wrong-root/node.exe')){\n $bad=[pscustomobject]@{FullName=$badName;Length=10;ExternalAttributes=0};$caught=$false;try{Get-BiliPlusSafeZipTargets -Entries @($valid,$bad) -Destination $dest -ExpectedRoot $rootName|Out-Null}catch{$caught=$true};Assert-Test $caught ('accepted unsafe path '+$badName)\n}\n$symlink=[pscustomobject]@{FullName=($rootName+'/link');Length=0;ExternalAttributes=-1610612736};$caught=$false;try{Get-BiliPlusSafeZipTargets -Entries @($valid,$symlink) -Destination $dest -ExpectedRoot $rootName|Out-Null}catch{$caught=$true};Assert-Test $caught 'symlink accepted'\n$duplicate=[pscustomobject]@{FullName=($rootName+'/NODE.EXE');Length=10;ExternalAttributes=0};$caught=$false;try{Get-BiliPlusSafeZipTargets -Entries @($valid,$duplicate) -Destination $dest -ExpectedRoot $rootName|Out-Null}catch{$caught=$true};Assert-Test $caught 'case duplicate accepted'\nAssert-Test (-not(Test-Path -LiteralPath $dest)) 'validation created extraction targets'`,
    );
  },
);
test(
  "portable bootstrap reuses a working system Node without downloading",
  { skip: !psAvailable },
  () => {
    ps(
      `. $data.bootstrapPath\nfunction Find-BiliPlusSystemNode{return $data.nodePath}\nfunction Install-BiliPlusPortableNode{param($PackageRoot)throw 'must not download'}\n$before=$env:PATH;$node=Resolve-BiliPlusNode -PackageRoot $data.packageRoot\nAssert-Test ($node -eq $data.nodePath) 'existing Node not reused'\nAssert-Test ($before -eq $env:PATH) 'PATH changed'`,
    );
  },
);
test(
  "official checksum parsing only selects Node 24 x64 ZIP and a hash mismatch never extracts or executes",
  { skip: !psAvailable },
  () => {
    ps(
      `. $data.bootstrapPath\n$script:seenUri='';function Invoke-WebRequest{param($Uri,[switch]$UseBasicParsing,$MaximumRedirection)$script:seenUri=$Uri;[pscustomobject]@{Content=(('f'*64)+'  node-v24.99.0-win-x64.zip'+[Environment]::NewLine+('e'*64)+'  node-v25.0.0-win-x64.zip')}}\n$release=Get-BiliPlusNodeRelease;Assert-Test ($release.RootName -eq 'node-v24.99.0-win-x64') 'wrong release selected';Assert-Test ($script:seenUri -eq 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt') 'manifest source not official'\nfunction Receive-BiliPlusNodeArchive{param($Uri,$Destination)[IO.File]::WriteAllText($Destination,'wrong bytes')}\nfunction Expand-BiliPlusNodeArchive{param($Archive,$Destination,$ExpectedRoot)throw 'must not extract'}\nfunction Test-BiliPlusNodeRuntime{param($NodePath)throw 'must not execute'}\n$caught=$false;try{Install-BiliPlusPortableNode -PackageRoot $data.packageRoot}catch{$caught=$_.Exception.Message -like '*SHA256*'}\nAssert-Test $caught 'checksum failure not enforced'\nAssert-Test (-not(Test-Path -LiteralPath (Join-Path $data.packageRoot '.runtime/node/selected-node.txt'))) 'bad runtime was selected'`,
    );
  },
);
test(
  "verified fixture ZIP extracts only inside the package and its selected portable Node is cached",
  { skip: !psAvailable },
  () => {
    for (const pathStyle of ["canonical", "mixed-dot"])
      ps(
        `. $data.bootstrapPath\nAdd-Type -AssemblyName System.IO.Compression\nAdd-Type -AssemblyName System.IO.Compression.FileSystem\n$script:sourceZip=Join-Path $data.base 'fixture.zip';$zip=[IO.Compression.ZipFile]::Open($script:sourceZip,[IO.Compression.ZipArchiveMode]::Create)\ntry{$entry=$zip.CreateEntry('node-v24.99.0-win-x64/node.exe');$stream=$entry.Open();try{$bytes=[Text.Encoding]::UTF8.GetBytes('fixture Node only');$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}}finally{$zip.Dispose()}\n$script:fixtureHash=(Get-BiliPlusFileSha256 -LiteralPath $script:sourceZip);$script:downloads=0\nfunction Get-BiliPlusNodeRelease{return [pscustomobject]@{Hash=$script:fixtureHash;FileName='node-v24.99.0-win-x64.zip';RootName='node-v24.99.0-win-x64';Uri='https://nodejs.org/dist/latest-v24.x/node-v24.99.0-win-x64.zip'}}\nfunction Receive-BiliPlusNodeArchive{param($Uri,$Destination)$script:downloads++;Copy-Item -LiteralPath $script:sourceZip -Destination $Destination}\nfunction Find-BiliPlusSystemNode{return $null}\nfunction Test-BiliPlusNodeRuntime{param($NodePath)return ((Test-Path -LiteralPath $NodePath) -and [IO.File]::ReadAllText($NodePath) -eq 'fixture Node only')}\n$before=$env:PATH;$node=Resolve-BiliPlusNode -PackageRoot $data.packageRoot;$cached=Resolve-BiliPlusNode -PackageRoot $data.packageRoot\nAssert-Test ($node -eq $cached -and $script:downloads -eq 1) 'portable runtime cache not reused'\n$runtimeDirectory=[IO.Path]::GetFullPath((Join-Path $data.packageRoot '.runtime/node')).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)\n$runtimeBoundary=$runtimeDirectory+[IO.Path]::DirectorySeparatorChar\nAssert-Test ([IO.Path]::GetFullPath($node).StartsWith($runtimeBoundary,[StringComparison]::OrdinalIgnoreCase)) ('runtime escaped package: expected child of '+$runtimeBoundary+'; received '+$node)\n$sibling=Join-Path ($runtimeDirectory+'-other') 'node.exe';$caught=$false;try{Assert-BiliPlusChildPath -Root $runtimeDirectory -Path $sibling|Out-Null}catch{$caught=$true};Assert-Test $caught 'same-prefix sibling accepted as runtime child'\nAssert-Test ($before -eq $env:PATH) 'PATH changed'`,
        { pathStyle },
      );
  },
);
function cliDeps(prepare) {
  const signals = new EventEmitter(),
    out = [],
    err = [];
  return {
    signals,
    stdout: { write: (x) => out.push(x) },
    stderr: { write: (x) => err.push(x) },
    prepare,
    out,
    err,
  };
}
test("model setup CLI needs no Codex, emits real preparation phases, and distinguishes text-model readiness from ASR", async () => {
  const d = cliDeps(async ({ model, onProgress }) => {
    assert.equal(model, "qwen3:4b");
    onProgress({
      stage: "local-pulling",
      status: "正在下载",
      completed: 5,
      total: 10,
    });
    return { model, runtimeReady: true, modelReady: true };
  });
  assert.equal(await setup.main([], d), 0);
  assert(d.out.join("").includes("50%"));
  assert(d.out.join("").includes("不表示 ASR 已安装"));
  assert.equal(d.signals.listenerCount("SIGINT"), 0);
});
test("model setup CLI rejects unknown models and incomplete readiness without reporting success", async () => {
  const bad = cliDeps(async () => {
    throw Error("must not call");
  });
  assert.equal(await setup.main(["--model", "unknown"], bad), 1);
  assert(bad.err.join("").includes("请选择"));
  for (const result of [
    { model: "qwen3:4b", runtimeReady: true, modelReady: false },
    { model: "qwen3:8b", runtimeReady: true, modelReady: true },
  ]) {
    const d = cliDeps(async () => result);
    assert.equal(await setup.main(["--json"], d), 1);
    assert(!d.out.join("").includes('"ready":true'));
  }
});
test("model setup CLI cancellation aborts the helper, returns 130 and removes only its signal listeners", async () => {
  const d = cliDeps(
    ({ signal }) =>
      new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
        queueMicrotask(() => d.signals.emit("SIGINT"));
      }),
  );
  const unrelated = () => {};
  d.signals.on("SIGINT", unrelated);
  assert.equal(await setup.main(["--json"], d), 130);
  assert(d.out.join("").includes('"cancelled":true'));
  assert.equal(d.signals.listenerCount("SIGINT"), 1);
  assert.equal(d.signals.listenerCount("SIGTERM"), 0);
});

test(
  "bootstrap checksum is SHA256 and external archive URLs are blocked before requests",
  { skip: !psAvailable },
  () => {
    ps(`. $data.bootstrapPath
$fixture=Join-Path $data.base 'sha.txt';[IO.File]::WriteAllText($fixture,'abc')
Assert-Test ((Get-BiliPlusFileSha256 -LiteralPath $fixture) -eq 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') 'wrong hash algorithm'
$script:requests=0;function Invoke-WebRequest{param($Uri,$OutFile,[switch]$UseBasicParsing,$MaximumRedirection)$script:requests++;throw 'must not request'}
foreach($uri in @('http://nodejs.org/dist/latest-v24.x/node-v24.1.0-win-x64.zip','https://evil.test/dist/latest-v24.x/node-v24.1.0-win-x64.zip','https://nodejs.org@evil.test/node.zip','https://nodejs.org/dist/latest-v25.x/node-v25.0.0-win-x64.zip')){
 $caught=$false;try{Receive-BiliPlusNodeArchive -Uri $uri -Destination (Join-Path $data.base 'never.zip')}catch{$caught=$true};Assert-Test $caught ('unsafe URL accepted '+$uri)
}
Assert-Test ($script:requests -eq 0) 'unsafe URL reached request boundary'`);
  },
);

test(
  "portable selection cannot escape package and invalid system Node fails without downloads",
  { skip: !psAvailable },
  () => {
    ps(`. $data.bootstrapPath
function Find-BiliPlusSystemNode{return $null}
function Install-BiliPlusPortableNode{param($PackageRoot)throw 'unexpected download'}
$runtime=Join-Path $data.packageRoot '.runtime/node';[void][IO.Directory]::CreateDirectory($runtime)
[IO.File]::WriteAllText((Join-Path $runtime 'selected-node.txt'),(Join-Path $data.base 'outside/node.exe'))
$caught=$false;try{Resolve-BiliPlusNode -PackageRoot $data.packageRoot}catch{$caught=$_.Exception.Message -like '*escapes*'}
Assert-Test $caught 'escaping cached selection accepted'
function Find-BiliPlusSystemNode{return $data.nodePath}
function Test-BiliPlusNodeRuntime{param($NodePath)return $false}
$caught=$false;try{Resolve-BiliPlusNode -PackageRoot $data.packageRoot}catch{$caught=$_.Exception.Message -like '*18 or newer*'}
Assert-Test $caught 'invalid system Node silently replaced'`);
  },
);

test(
  "runtime host build failure preserves existing service host and registration config",
  { skip: !psAvailable },
  () => {
    ps(
      `$runtime=Join-Path $data.packageRoot 'native/runtime.json';$launcher=Join-Path $data.packageRoot 'native/BiliCodexHost.exe';$hostFile=Join-Path $data.packageRoot 'native/RuntimeHost.exe'\n[IO.File]::WriteAllText($runtime,'{"provider":"local"}');[IO.File]::WriteAllText($launcher,'old launcher');[IO.File]::WriteAllText($hostFile,'old runtime host')\nfunction Build-BiliPlusRuntimeHost{param($NativeRoot,$Destination)throw 'QA runtime host build failed'}\n$caught=$false;try{Install-BiliPlusBridge -PackageRoot $data.packageRoot -SkipModelSetup}catch{$caught=$true}\nAssert-Test $caught 'runtime host build failure was hidden'\nAssert-Test ([IO.File]::ReadAllText($runtime) -eq '{"provider":"local"}') 'runtime config changed'\nAssert-Test ([IO.File]::ReadAllText($launcher) -eq 'old launcher') 'launcher changed'\nAssert-Test ([IO.File]::ReadAllText($hostFile) -eq 'old runtime host') 'runtime host changed'`,
    );
  },
);
