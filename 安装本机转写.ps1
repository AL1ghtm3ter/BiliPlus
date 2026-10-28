param([ValidateSet('small','base')][string]$Model='small')
$ErrorActionPreference='Stop'
$runtimeRoot=Join-Path $PSScriptRoot '.runtime'
$venvRoot=Join-Path $runtimeRoot 'asr-env'
$uvCommand=Get-Command uv.exe -ErrorAction SilentlyContinue
$uv=if($uvCommand){$uvCommand.Source}else{Join-Path $env:LOCALAPPDATA 'hermes\bin\uv.exe'}
if(-not(Test-Path -LiteralPath $uv)){throw 'uv.exe not found. Install uv from https://docs.astral.sh/uv/getting-started/installation/ and rerun this script.'}
& $uv --cache-dir (Join-Path $runtimeRoot 'uv-cache') venv --python 3.11 --allow-existing $venvRoot
if($LASTEXITCODE -ne 0){throw 'Python environment setup failed.'}
$pythonPath=Join-Path $venvRoot 'Scripts\python.exe'
& $uv --cache-dir (Join-Path $runtimeRoot 'uv-cache') pip install --python $pythonPath -r (Join-Path $PSScriptRoot 'native\requirements-asr.lock.txt')
if($LASTEXITCODE -ne 0){throw 'ASR package installation failed.'}
$env:PYTHONIOENCODING='utf-8'
& $pythonPath (Join-Path $PSScriptRoot 'native\setup_asr.py') --model $Model --runtime $runtimeRoot
if($LASTEXITCODE -ne 0){throw 'ASR model setup failed.'}
Write-Output 'Local ASR is ready. Transcription runs on this computer with CPU int8.'
