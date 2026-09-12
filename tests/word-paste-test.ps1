param([Parameter(Mandatory=$true)][string]$Out)
# 实测：把不同格式写入剪贴板（在启动 Office 之前），再启动 Word/WPS 粘贴，检查是否生成公式/对象
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Windows.Forms

$SUM = [char]0x2211
$INF = [char]0x221E
$sumText = "$SUM" + '_(n=-' + $INF + ')^(' + $INF + ') c_n (z-z_0)'
$latex = '\sum_{n=-\infty}^{\infty} c_n (z-z_0)'
$omml = '<m:oMath><m:nary><m:naryPr><m:chr m:val="' + $SUM + '"/><m:limLoc m:val="undOvr"/></m:naryPr>' +
        '<m:sub><m:r><m:t>n=-' + $INF + '</m:t></m:r></m:sub><m:sup><m:r><m:t>' + $INF + '</m:t></m:r></m:sup>' +
        '<m:e><m:sSub><m:e><m:r><m:t>c</m:t></m:r></m:e><m:sub><m:r><m:t>n</m:t></m:r></m:sub></m:sSub>' +
        '<m:r><m:t>(z-z</m:t></m:r><m:sSub><m:e><m:r><m:t></m:t></m:r></m:e><m:sub><m:r><m:t>0</m:t></m:r></m:sub></m:sSub>' +
        '<m:r><m:t>)</m:t></m:r></m:e></m:nary></m:oMath>'
$mathml = '<math xmlns="http://www.w3.org/1998/Math/MathML"><munderover><mo>&#8721;</mo>' +
          '<mrow><mi>n</mi><mo>=</mo><mo>-</mo><mi>&#8734;</mi></mrow><mi>&#8734;</mi></munderover>' +
          '<msub><mi>c</mi><mi>n</mi></msub><mo>(</mo><mi>z</mi><mo>-</mo><msub><mi>z</mi><mn>0</mn></msub><mo>)</mo></math>'
$htmlOmml = '<html xmlns:m="http://schemas.microsoft.com/office/2004/12/omml"><body>' + $omml + '</body></html>'
$htmlMathml = '<html><body>' + $mathml + '</body></html>'

$cases = @(
  @{ name = 'A latex text';        text = $latex;   rtf = ''; html = '';         mathml = '' },
  @{ name = 'B unicodemath text';  text = $sumText; rtf = ''; html = '';         mathml = '' },
  @{ name = 'C MathML clipboard';  text = 'sum';    rtf = ''; html = '';         mathml = $mathml },
  @{ name = 'D HTML+MathML';       text = 'sum';    rtf = ''; html = $htmlMathml; mathml = '' },
  @{ name = 'E HTML+OMML';         text = 'sum';    rtf = ''; html = $htmlOmml;   mathml = '' }
)

$results = @()
foreach ($c in $cases) {
  # 1) 先写剪贴板（此时 Office 未启动）
  try {
    $do = New-Object System.Windows.Forms.DataObject
    if ($c.text)   { $do.SetData('UnicodeText', [string]$c.text) }
    if ($c.rtf)    { $do.SetData('Rich Text Format', [string]$c.rtf) }
    if ($c.html)   { $do.SetData('HTML Format', [string]$c.html) }
    if ($c.mathml) { $do.SetData('MathML', [string]$c.mathml) }
    $ok = $false
    for ($i = 0; $i -lt 20 -and -not $ok; $i++) {
      try { [System.Windows.Forms.Clipboard]::SetDataObject($do, $true, 3, 120); $ok = $true }
      catch { Start-Sleep -Milliseconds 250 }
    }
    if (-not $ok) { $results += ("{0} => clipboard busy" -f $c.name); continue }
  } catch { $results += ("{0} => set clipboard error: {1}" -f $c.name, $_.Exception.Message); continue }

  # 2) 启动 Office，粘贴，检查
  $word = $null
  try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    try { $word.DisplayAlerts = 0 } catch {}
    $doc = $word.Documents.Add()
    try { $doc.Activate() } catch {}
    Start-Sleep -Milliseconds 250
    $word.Selection.Paste()
    Start-Sleep -Milliseconds 900

    $om = 'n/a'; try { $om = [int]$doc.OMaths.Count } catch { $om = 'no-API' }
    $shapes = 'n/a'; try { $shapes = [int]$doc.InlineShapes.Count } catch { $shapes = 'no-API' }
    $fields = 'n/a'; try { $fields = [int]$doc.Fields.Count } catch { $fields = 'no-API' }
    $txt = ''
    try { $txt = [string]$doc.Content.Text } catch {}
    if ($txt.Length -gt 40) { $txt = $txt.Substring(0, 40) }
    $txt = ($txt -replace "[^\x20-\x7E]", '?')
    $results += ("{0} => OMaths={1} InlineShapes={2} Fields={3} Text='{4}'" -f $c.name, $om, $shapes, $fields, $txt)
  } catch {
    $results += ("{0} => paste error: {1}" -f $c.name, $_.Exception.Message)
  } finally {
    try { if ($word) { $word.Quit(0) } } catch {}
    Start-Sleep -Milliseconds 500
  }
}

$results -join "`n" | Out-File -FilePath $Out -Encoding utf8
$results -join "`n"
