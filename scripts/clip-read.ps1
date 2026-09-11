param([Parameter(Mandatory=$true)][string]$OutFile)
# 读取系统剪贴板中的原生格式（RTF / HTML / 纯文本），输出为 UTF-8(无BOM) JSON
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Windows.Forms
  $res = @{ ok = $false; text = ''; rtf = ''; html = '' }
  $do = [System.Windows.Forms.Clipboard]::GetDataObject()
  if ($do -ne $null) {
    $res.ok = $true
    try { if ($do.GetDataPresent('UnicodeText')) { $res.text = [string]$do.GetData('UnicodeText') } } catch {}
    try { if ($do.GetDataPresent('Rich Text Format')) {
      $d = $do.GetData('Rich Text Format')
      if ($d -is [System.IO.Stream]) { $sr = New-Object System.IO.StreamReader($d, [System.Text.Encoding]::UTF8); $res.rtf = $sr.ReadToEnd(); $sr.Close() }
      else { $res.rtf = [string]$d }
    } } catch {}
    try { if ($do.GetDataPresent('HTML Format')) {
      $d = $do.GetData('HTML Format')
      if ($d -is [System.IO.Stream]) { $sr = New-Object System.IO.StreamReader($d, [System.Text.Encoding]::UTF8); $res.html = $sr.ReadToEnd(); $sr.Close() }
      else { $res.html = [string]$d }
    } } catch {}
  }
  $json = $res | ConvertTo-Json -Compress
} catch {
  $json = (@{ ok = $false; err = $_.Exception.Message } | ConvertTo-Json -Compress)
}
[System.IO.File]::WriteAllText($OutFile, $json, (New-Object System.Text.UTF8Encoding($false)))
