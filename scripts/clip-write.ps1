param([Parameter(Mandatory=$true)][string]$InFile)
# 把原生格式（RTF / HTML / 纯文本）写回系统剪贴板；Word 会优先采用 RTF，从而得到"可编辑公式"
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Windows.Forms
  $json = [System.IO.File]::ReadAllText($InFile, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
  $do = New-Object System.Windows.Forms.DataObject
  $any = $false
  if ($json.text -and [string]$json.text -ne '') { $do.SetData('UnicodeText', [string]$json.text); $any = $true }
  if ($json.rtf -and [string]$json.rtf -ne '') { $do.SetData('Rich Text Format', [string]$json.rtf); $any = $true }
  if ($json.html -and [string]$json.html -ne '') { $do.SetData('HTML Format', [string]$json.html); $any = $true }
  if (-not $any) { exit 2 }
  [System.Windows.Forms.Clipboard]::SetDataObject($do, $true)
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
