# Navigate to project root (parent of utils/)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
Set-Location $ProjectRoot

python utils/handler.py

Read-Host -Prompt "Press Enter to continue"