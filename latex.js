'use strict'
// MathML / OMML(Word 公式 XML) -> LaTeX 转换器
// 目标：把剪贴板里公式的结构信息转成 LaTeX 文本，便于粘贴进 Word 公式编辑器编译。

// ---------------- 轻量 XML 解析 ----------------
function parseXml(src) {
  const root = { name: '#root', attrs: {}, children: [] }
  const stack = [root]
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<\/([A-Za-z_][\w:.\-]*)\s*>|<([A-Za-z_][\w:.\-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|([^<]+)/g
  let m
  while ((m = re.exec(src)) !== null) {
    if (m[1] !== undefined) {
      stack[stack.length - 1].children.push({ name: '#text', text: m[1] })
    } else if (m[2]) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === m[2]) { stack.length = i; break }
      }
    } else if (m[3]) {
      const node = { name: m[3], attrs: {}, children: [] }
      const attrRe = /([\w:.\-]+)\s*=\s*("([^"]*)"|'([^']*)')/g
      let a
      while ((a = attrRe.exec(m[4] || '')) !== null) node.attrs[a[1]] = a[3] !== undefined ? a[3] : a[4]
      stack[stack.length - 1].children.push(node)
      if (!m[5]) stack.push(node)
    } else if (m[6] !== undefined && m[6].trim()) {
      stack[stack.length - 1].children.push({ name: '#text', text: m[6] })
    }
  }
  return root
}

const local = (n) => String(n).replace(/^.*:/, '').toLowerCase()
const kids = (n) => (n && n.children) || []
const textOf = (n) => kids(n).map((c) => (c.name === '#text' ? c.text : textOf(c))).join('')
const esc = (s) => String(s).replace(/([#$%&_{}])/g, '\\$1')
const stripTags = (s) => String(s).replace(/<[^>]*>/g, '')

// RTF 反转义（\\( \{ \} 以及 \'hh）
function unescapeRtf(s) {
  return String(s || '')
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/\\([\\{}])/g, '$1')
}

// HTML/XML 实体解码（Word 的 MathML 常用 &#8721; 这类数字实体表示符号）
function safeChar(cp) {
  try { return Number.isFinite(cp) ? String.fromCodePoint(cp) : '' } catch { return '' }
}
function decodeEntities(s) {
  return String(s == null ? '' : s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

// 大运算符（可带上下限）
const BIGOP = {
  '∑': '\\sum', '∏': '\\prod', '∫': '\\int', '∬': '\\iint', '∭': '\\iiint',
  '∮': '\\oint', '⋃': '\\bigcup', '⋂': '\\bigcap', 'lim': '\\lim', 'max': '\\max', 'min': '\\min'
}
function bigOpOf(node) {
  if (!node) return null
  if (node.name === '#text') return BIGOP[decodeEntities(node.text).trim()] || null
  if (kids(node).length === 1) return bigOpOf(kids(node)[0])
  const t = decodeEntities(textOf(node)).trim()
  return BIGOP[t] || null
}
function bare(node) {
  // 单字母/数字/简单命令不需要再包一层花括号
  const s = mml(node)
  if (/^\\?[A-Za-z0-9]$/.test(s) || /^\\[a-zA-Z]+$/.test(s)) return s
  return '{' + s + '}'
}

// ---------------- 符号映射 ----------------
const SYM = {
  '×': '\\times ', '÷': '\\div ', '·': '\\cdot ', '⋅': '\\cdot ', '∗': '\\ast ', '∘': '\\circ ',
  '±': '\\pm ', '∓': '\\mp ', '≤': '\\le ', '≥': '\\ge ', '≠': '\\ne ', '≈': '\\approx ', '≡': '\\equiv ',
  '∞': '\\infty ', '∂': '\\partial ', '∇': '\\nabla ', '√': '\\sqrt ', '∛': '\\sqrt[3] ',
  '∑': '\\sum ', '∏': '\\prod ', '∫': '\\int ', '∬': '\\iint ', '∭': '\\iiint ', '∮': '\\oint ',
  '∈': '\\in ', '∉': '\\notin ', '⊂': '\\subset ', '⊆': '\\subseteq ', '⊃': '\\supset ', '⊇': '\\supseteq ',
  '∪': '\\cup ', '∩': '\\cap ', '∅': '\\emptyset ', '∀': '\\forall ', '∃': '\\exists ',
  '→': '\\to ', '←': '\\leftarrow ', '↔': '\\leftrightarrow ', '⇒': '\\Rightarrow ', '⇔': '\\Leftrightarrow ',
  '↑': '\\uparrow ', '↓': '\\downarrow ', '∠': '\\angle ', '⊥': '\\perp ', '∥': '\\parallel ',
  '⋯': '\\cdots ', '…': '\\dots ', '⋅⋅': '\\cdot ',
  'α': '\\alpha ', 'β': '\\beta ', 'γ': '\\gamma ', 'δ': '\\delta ', 'ε': '\\epsilon ', 'ζ': '\\zeta ',
  'η': '\\eta ', 'θ': '\\theta ', 'ι': '\\iota ', 'κ': '\\kappa ', 'λ': '\\lambda ', 'μ': '\\mu ',
  'ν': '\\nu ', 'ξ': '\\xi ', 'π': '\\pi ', 'ρ': '\\rho ', 'σ': '\\sigma ', 'τ': '\\tau ', 'υ': '\\upsilon ',
  'φ': '\\phi ', 'χ': '\\chi ', 'ψ': '\\psi ', 'ω': '\\omega ',
  'Γ': '\\Gamma ', 'Δ': '\\Delta ', 'Θ': '\\Theta ', 'Λ': '\\Lambda ', 'Ξ': '\\Xi ', 'Π': '\\Pi ',
  'Σ': '\\Sigma ', 'Φ': '\\Phi ', 'Ψ': '\\Psi ', 'Ω': '\\Omega '
}

function moToLatex(t) {
  const s = String(t).trim()
  if (SYM[s]) return SYM[s]
  if (s === '' ) return ''
  return esc(s)
}

function brace(node, fn) {
  const s = fn(node)
  if (/^\\?[A-Za-z0-9]$/.test(s) || /^\\[a-zA-Z]+$/.test(s)) return s
  return '{' + s + '}'
}

// ---------------- MathML ----------------
function mml(node) {
  if (!node) return ''
  if (node.name === '#text') return ''
  const n = local(node.name)
  const ch = kids(node)
  switch (n) {
    case 'math': case 'mrow': case 'mstyle': case 'mpadded': case 'mphantom':
    case 'semantics': case 'annotation': case 'mstack': case 'mstyle2':
      return ch.map(mml).join('')
    case 'mi': {
      const t = decodeEntities(textOf(node)).trim()
      return SYM[t] ? SYM[t] : esc(t)
    }
    case 'mn': return esc(decodeEntities(textOf(node)).trim())
    case 'mo': return moToLatex(decodeEntities(textOf(node)))
    case 'mtext': return '\\text{' + esc(decodeEntities(textOf(node))) + '}'
    case 'mspace': return '\\,'
    case 'mfrac': return '\\frac{' + (ch[0] ? mml(ch[0]) : '') + '}{' + (ch[1] ? mml(ch[1]) : '') + '}'
    case 'msup': {
      const bo = bigOpOf(ch[0])
      return (bo || bare(ch[0])) + '^{' + (ch[1] ? mml(ch[1]) : '') + '}'
    }
    case 'msub': {
      const bo = bigOpOf(ch[0])
      return (bo || bare(ch[0])) + '_{' + (ch[1] ? mml(ch[1]) : '') + '}'
    }
    case 'msubsup': {
      const bo = bigOpOf(ch[0])
      return (bo || bare(ch[0])) + '_{' + (ch[1] ? mml(ch[1]) : '') + '}^{' + (ch[2] ? mml(ch[2]) : '') + '}'
    }
    case 'msqrt': return '\\sqrt{' + ch.map(mml).join('') + '}'
    case 'mroot': return '\\sqrt[' + (ch[1] ? mml(ch[1]) : '') + ']{' + (ch[0] ? mml(ch[0]) : '') + '}'
    case 'mfenced': {
      const open = node.attrs.open !== undefined ? node.attrs.open : '('
      const close = node.attrs.close !== undefined ? node.attrs.close : ')'
      return '\\left' + open + ch.map(mml).join('') + '\\right' + close
    }
    case 'mover': {
      const bo = bigOpOf(ch[0])
      if (bo) return bo + '^{' + (ch[1] ? mml(ch[1]) : '') + '}'
      return '\\overset{' + (ch[1] ? mml(ch[1]) : '') + '}{' + (ch[0] ? mml(ch[0]) : '') + '}'
    }
    case 'munder': {
      const bo = bigOpOf(ch[0])
      if (bo) return bo + '_{' + (ch[1] ? mml(ch[1]) : '') + '}'
      return '\\underset{' + (ch[1] ? mml(ch[1]) : '') + '}{' + (ch[0] ? mml(ch[0]) : '') + '}'
    }
    case 'munderover': {
      const bo = bigOpOf(ch[0])
      if (bo) return bo + '_{' + (ch[1] ? mml(ch[1]) : '') + '}^{' + (ch[2] ? mml(ch[2]) : '') + '}'
      return '\\overset{' + (ch[2] ? mml(ch[2]) : '') + '}{\\underset{' + (ch[1] ? mml(ch[1]) : '') + '}{' + (ch[0] ? mml(ch[0]) : '') + '}}'
    }
    case 'mtable': {
      const rows = ch.filter((c) => local(c.name) === 'mtr')
      return '\\begin{matrix}' + rows.map((r) => kids(r).filter((c) => local(c.name) === 'mtd').map((c) => c.children.map(mml).join('')).join(' & ')).join(' \\\\ ') + '\\end{matrix}'
    }
    case 'mtr': return ch.filter((c) => local(c.name) === 'mtd').map((c) => c.children.map(mml).join('')).join(' & ')
    case 'mtd': return ch.map(mml).join('')
    case 'menclose': return ch.map(mml).join('')
    default: return ch.map(mml).join('')
  }
}

// ---------------- OMML (Word) ----------------
function omml(node) {
  if (!node) return ''
  if (node.name === '#text') return ''
  const n = local(node.name)
  const ch = kids(node)
  const pick = (name) => ch.find((c) => local(c.name) === name)
  const all = (name) => ch.filter((c) => local(c.name) === name)
  switch (n) {
    case 'omath': case 'omathpara': case 'e': case 'num': case 'den': case 'sub': case 'sup':
    case 'deg': case 'fname': case 'lim': case 'groupchr':
      return ch.map(omml).join('')
    case 'r': return all('t').map((t) => esc(textOf(t))).join('')
    case 't': return esc(textOf(node))
    case 'f': {
      const num = pick('num'), den = pick('den')
      return '\\frac{' + (num ? omml(num) : '') + '}{' + (den ? omml(den) : '') + '}'
    }
    case 'ssup': return brace(pick('e'), omml) + '^{' + (pick('sup') ? omml(pick('sup')) : '') + '}'
    case 'ssub': return brace(pick('e'), omml) + '_{' + (pick('sub') ? omml(pick('sub')) : '') + '}'
    case 'ssubsup': return brace(pick('e'), omml) + '_{' + (pick('sub') ? omml(pick('sub')) : '') + '}^{' + (pick('sup') ? omml(pick('sup')) : '') + '}'
    case 'rad': {
      const deg = pick('deg'), e = pick('e')
      const d = deg ? omml(deg) : ''
      return d ? '\\sqrt[' + d + ']{' + (e ? omml(e) : '') + '}' : '\\sqrt{' + (e ? omml(e) : '') + '}'
    }
    case 'd': {
      const pr = pick('dpr')
      let open = '(', close = ')'
      if (pr) {
        const b = pr.attrs['m:begChr'] || pr.attrs.begChr
        const en = pr.attrs['m:endChr'] || pr.attrs.endChr
        if (b !== undefined) open = b
        if (en !== undefined) close = en
      }
      return '\\left' + open + all('e').map(omml).join('') + '\\right' + close
    }
    case 'nary': {
      const pr = pick('narypr')
      let chr = '\\int '
      if (pr) {
        const c = pr.attrs['m:chr'] || pr.attrs.chr
        if (c) chr = (SYM[c] || c)
      }
      const sub = pick('sub'), sup = pick('sup'), e = pick('e')
      let out = chr
      if (sub) out += '_{' + omml(sub) + '}'
      if (sup) out += '^{' + omml(sup) + '}'
      if (e) out += ' ' + omml(e)
      return out
    }
    case 'func': {
      const fn = pick('fname'), e = pick('e')
      return (fn ? omml(fn) : '') + (e ? '\\left(' + omml(e) + '\\right)' : '')
    }
    case 'acc': {
      const pr = pick('accpr'); const e = pick('e')
      let chr = '\\hat'
      if (pr) { const c = pr.attrs['m:chr'] || pr.attrs.chr; if (c === '‾' || c === '-') chr = '\\bar'; else if (c === '→') chr = '\\vec'; else if (c === '.') chr = '\\dot'; else if (c === '¨') chr = '\\ddot' }
      return chr + '{' + (e ? omml(e) : '') + '}'
    }
    case 'bar': { const e = pick('e'); return '\\overline{' + (e ? omml(e) : '') + '}' }
    case 'm': { // matrix
      const rows = all('mr')
      return '\\begin{matrix}' + rows.map((r) => all('e').length ? all('e').map(omml).join(' & ') : kids(r).filter((c) => local(c.name) === 'e').map(omml).join(' & ')).join(' \\\\ ') + '\\end{matrix}'
    }
    case 'mr': return all('e').map(omml).join(' & ')
    default: return ch.map(omml).join('')
  }
}

// ---------------- 对外接口 ----------------
// HTML（Word 复制公式常见的 sup/sub、表格分数结构）-> LaTeX
function htmlToLatex(html) {
  let s = String(html || '')
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
  const b = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(s)
  if (b) s = b[1]
  s = s.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, tbl) => {
    const rows = []
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
    let m
    while ((m = rowRe.exec(tbl)) !== null) rows.push(stripTags(m[1]).replace(/\s+/g, ' ').trim())
    if (rows.length === 2 && rows[0] && rows[1]) return '\\frac{' + rows[0] + '}{' + rows[1] + '}'
    return rows.join(' ')
  })
  s = s.replace(/<sup[^>]*>([\s\S]*?)<\/sup>/gi, (_, x) => '^{' + stripTags(x).replace(/\s+/g, '') + '}')
  s = s.replace(/<sub[^>]*>([\s\S]*?)<\/sub>/gi, (_, x) => '_{' + stripTags(x).replace(/\s+/g, '') + '}')
  s = s.replace(/<br\s*\/?>/gi, ' ')
  s = stripTags(s)
  s = decodeEntities(s).replace(/\u00a0/g, ' ')
  s = s.replace(/([∑∏∫√≤≥≠±×÷∞∂∇∈∪∩→←↔⇒⇔αβγδεζηθικλμνξπρστυφχψωΓΔΘΛΞΠΣΦΨΩ])/g, (c) => SYM[c] || c)
  return s.replace(/\s+/g, ' ').trim()
}

function extractMathml(html) {
  const m = /<math[\s>][\s\S]*?<\/math>/i.exec(String(html || ''))
  return m ? m[0] : ''
}
function extractOmml(xmlish) {
  const s = String(xmlish || '')
  let m = /<(?:m:)?oMath\b[\s\S]*?<\/(?:m:)?oMath>/i.exec(s)
  if (m) return m[0]
  m = /<(?:m:)?oMathPara\b[\s\S]*?<\/(?:m:)?oMathPara>/i.exec(s)
  return m ? m[0] : ''
}

function clean(latex) {
  return String(latex || '')
    .replace(/\s+/g, ' ')
    .replace(/(\\[a-zA-Z]+) +(?=[_^{}\]])/g, '$1')   // \sum _{...} -> \sum_{...}；\infty } -> \infty}
    .replace(/\\left\s*\\right/g, '')
    .trim()
}

// 从记录的 HTML / RTF / 纯文本 中推导 LaTeX
function toLatex({ html, rtf, mathml, plain }) {
  // 1) MathML
  try {
    const mmlSrc = extractMathml(html) || (mathml && /<math[\s>]/i.test(mathml) ? mathml : '')
    if (mmlSrc) {
      const tree = parseXml(mmlSrc)
      const out = clean(mml(tree.children.find((c) => local(c.name) === 'math') || tree))
      if (out) return out
    }
  } catch {}
  // 2) OMML（RTF 里可能是转义形式，先原样再反转义各试一次）
  try {
    const ommlSrc = extractOmml(rtf) || extractOmml(unescapeRtf(rtf)) || extractOmml(html)
    if (ommlSrc) {
      const tree = parseXml(ommlSrc)
      const root = tree.children.find((c) => /omath/i.test(c.name)) || tree
      const out = clean(omml(root))
      if (out) return out
    }
  } catch {}
  // 3) HTML 的上下标 / 表格分数结构
  try {
    if (/<sup|<sub|<table/i.test(String(html || ''))) {
      const out = clean(htmlToLatex(html))
      if (out && /(\\frac|\^\{|_\{|=)/.test(out)) return out
    }
  } catch {}
  // 4) 纯文本本身就是公式：LaTeX 源码（AI 聊天常见）或线性公式
  try {
    const t = String(plain || '').trim()
    if (t && t.length <= 2000 && isFormulaText(t)) return clean(t)
  } catch {}
  return ''
}

// 判断纯文本是否本身就是公式（LaTeX 源码或线性格式）
function isFormulaText(t) {
  if (/\\[a-zA-Z]{2,}/.test(t)) return true                  // \frac \sum \alpha ...
  if (/[∑∏∫√∞≠≤≥±∓]/.test(t)) return true                   // 数学符号
  if (/\^/.test(t) && /[a-zA-Z0-9]/.test(t)) return true      // 含上标
  if (/[a-zA-Z0-9]\s*\/\s*[a-zA-Z0-9(]/.test(t) && /[∫∑√∏]|[a-zA-Z]_[a-zA-Z0-9]/.test(t)) return true
  return false
}

module.exports = { toLatex, parseXml, mmlToLatex: mml, ommlToLatex: omml, extractMathml, extractOmml, htmlToLatex, isFormulaText }
