param([Parameter(Mandatory=$true)][string]$Out)
# 在 WPS 里实测：把纯文本公式语法转成公式（等价于 Ctrl+= / 转换功能），检查生成的公式 XML 结构
$ErrorActionPreference = 'Continue'
$SUM = [char]0x2211
$INF = [char]0x221E
$NE = [char]0x2260

$texts = @(
  @{ n = '1 unicodemath-sum'; t = "$SUM`_(n=-$INF)^($INF) c_n (z-z_0)" },
  @{ n = '2 latex-sum';       t = '\sum_{n=-\infty}^{\infty} c_n (z-z_0)' },
  @{ n = '3 unicodemath-frac'; t = 'c_n=(a+b)/(c)' },
  @{ n = '4 latex-frac';       t = 'c_n=\frac{a+b}{c}' },
  @{ n = '5 unicodemath-lim';  t = 'lim_(x' + [char]0x2192 + '0)(sin x)/(x)' },
  @{ n = '6 latex-lim';        t = '\lim_{x \to 0}\frac{\sin x}{x}' }
)

$results = @()
$w = $null
try {
  $w = New-Object -ComObject Word.Application
  $w.Visible = $false
  try { $w.DisplayAlerts = 0 } catch {}
  $results += 'engine: ' + $w.Path
} catch {
  $results += 'COM failed: ' + $_.Exception.Message
  $results -join "`n" | Out-File $Out -Encoding utf8
  exit 1
}

foreach ($c in $texts) {
  $doc = $null
  try {
    $doc = $w.Documents.Add()
    try { $doc.Activate() } catch {}
    Start-Sleep -Milliseconds 200
    $sel = $w.Selection
    if ($null -eq $sel) { $results += ("{0} => selection null" -f $c.n); continue }
    $sel.TypeText($c.t)
    Start-Sleep -Milliseconds 200
    $sel.WholeStory()

    $added = 'no-api'
    try { $null = $doc.OMaths.Add($sel.Range); $added = 'ok' } catch { $added = 'add-failed: ' + $_.Exception.Message }
    Start-Sleep -Milliseconds 300

    $omCount = -1
    try { $omCount = [int]$doc.OMaths.Count } catch { $omCount = 'no-api' }
    $built = ''
    if ($omCount -gt 0) {
      try { $doc.OMaths.Item(1).BuildUp(); $built = 'buildup-ok' } catch { $built = 'buildup-failed' }
      Start-Sleep -Milliseconds 300
    }
    $xml = ''
    try { $xml = [string]$doc.OMaths.Item(1).Range.WordOpenXML } catch {}
    if (-not $xml) { try { $xml = [string]$doc.Content.XML } catch {} }
    # 只取公式本体片段来判断结构
    $seg = ''
    if ($xml -match '(?s)<m:oMath>.*?</m:oMath>') { $seg = $matches[0] } else { $seg = $xml }
    $markers = @()
    if ($seg -match 'm:f') { $markers += 'frac' }
    if ($seg -match 'm:sSub') { $markers += 'sub' }
    if ($seg -match 'm:sSup') { $markers += 'sup' }
    if ($seg -match 'm:nary') { $markers += 'nary' }
    if ($seg -match 'm:rad') { $markers += 'rad' }
    if ($seg -match 'm:d') { $markers += 'delim' }
    $preview = $seg
    if ($preview.Length -gt 260) { $preview = $preview.Substring(0, 260) }
    $preview = $preview -replace "[^\x20-\x7E]", '.'
    $results += ("{0} => add={1} OMaths={2} {3} markers=[{4}] oMathLen={5}" -f $c.n, $added, $omCount, $built, ($markers -join ','), $seg.Length)
    $results += ("      xml: " + $preview)
  } catch {
    $results += ("{0} => error: {1}" -f $c.n, $_.Exception.Message)
  } finally {
    # 不关闭文档：WPS 关闭最后一个文档后 COM 对象会失效
    Start-Sleep -Milliseconds 200
  }
}

try { $w.Quit(0) } catch {}
$results -join "`n" | Out-File -FilePath $Out -Encoding utf8
$results -join "`n"
