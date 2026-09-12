param([Parameter(Mandatory=$true)][string]$Out)
# 模拟真实操作：在文档里输入线性公式文本 -> 全选 -> 按 Ctrl+= -> 检查是否生成公式结构
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName Microsoft.VisualBasic

$SUM = [char]0x2211
$INF = [char]0x221E

$cases = @(
  @{ n = 'um  c_n';            t = 'c_n' },
  @{ n = 'um  c_(n)';          t = 'c_(n)' },
  @{ n = 'um  x^2';            t = 'x^2' },
  @{ n = 'um  x^(2)';          t = 'x^(2)' },
  @{ n = 'um  sum sub/sup';    t = "$SUM`_(n=1)^($INF) c_n" },
  @{ n = 'latex c_n';          t = 'c_n' },
  @{ n = 'latex sum';          t = '\sum_{n=1}^{\infty} c_n' },
  @{ n = 'um  frac+sub';       t = 'f(z)=f(z_0)+f''(z_0)/(2!)' }
)

$results = @()
$w = $null
try {
  $w = New-Object -ComObject Word.Application
  $w.Visible = $true
  try { $w.DisplayAlerts = 0 } catch {}
} catch {
  $results += 'COM failed: ' + $_.Exception.Message
  $results -join "`n" | Out-File -FilePath $Out -Encoding utf8
  exit 1
}

foreach ($c in $cases) {
  $doc = $null
  try {
    $doc = $w.Documents.Add()
    try { $doc.Activate() } catch {}
    Start-Sleep -Milliseconds 250
    $sel = $w.Selection
    if ($null -eq $sel) { $results += ("{0} => selection null" -f $c.n); continue }
    $sel.TypeText($c.t)
    Start-Sleep -Milliseconds 250
    $sel.WholeStory()
    Start-Sleep -Milliseconds 250
    try { $w.Activate() } catch {}
    Start-Sleep -Milliseconds 250
    [System.Windows.Forms.SendKeys]::SendWait('^{=}')
    Start-Sleep -Milliseconds 900

    $omCount = -1
    try { $omCount = [int]$doc.OMaths.Count } catch { $omCount = 'no-api' }
    $xml = ''
    try { $xml = [string]$doc.Content.XML } catch {}
    $seg = ''
    if ($xml -match '(?s)<m:oMath>.*?</m:oMath>') { $seg = $matches[0] }
    $markers = @()
    if ($seg -match 'm:f') { $markers += 'frac' }
    if ($seg -match 'm:sSub') { $markers += 'sub' }
    if ($seg -match 'm:sSup') { $markers += 'sup' }
    if ($seg -match 'm:nary') { $markers += 'nary' }
    $text = ''
    try { $text = [string]$doc.Content.Text } catch {}
    if ($text.Length -gt 30) { $text = $text.Substring(0, 30) }
    $text = $text -replace "[^\x20-\x7E]", '.'
    $results += ("{0,-16} => OMaths={1} markers=[{2}] oMathLen={3} text='{4}'" -f $c.n, $omCount, ($markers -join ','), $seg.Length, $text)
  } catch {
    $results += ("{0} => error: {1}" -f $c.n, $_.Exception.Message)
  } finally {
    Start-Sleep -Milliseconds 200
  }
}

$results -join "`n" | Out-File -FilePath $Out -Encoding utf8
$results -join "`n"
