'use strict'
// MathML / OMML(Word、WPS 公式 XML) -> LaTeX 转换器
// 覆盖常见数学形式：分式、上下标、根式、极限、求和/积分（带上下限）、导数、矩阵、分段函数、
// 向量/帽子/上划线、二项式、取整、集合与逻辑、箭头、希腊字母等。

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
function unescapeRtf(s) {
  return String(s || '')
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/\\([\\{}])/g, '$1')
}

// ---------------- 符号 / 函数名 ----------------
const SYM = {
  '×': '\\times ', '÷': '\\div ', '·': '\\cdot ', '⋅': '\\cdot ', '∗': '\\ast ', '∘': '\\circ ',
  '±': '\\pm ', '∓': '\\mp ', '≤': '\\le ', '⩽': '\\le ', '≥': '\\ge ', '⩾': '\\ge ',
  '≠': '\\ne ', '≈': '\\approx ', '≃': '\\simeq ', '≅': '\\cong ', '≡': '\\equiv ',
  '∼': '\\sim ', '∝': '\\propto ', '≪': '\\ll ', '≫': '\\gg ', '≜': '\\triangleq ',
  '∞': '\\infty ', '∂': '\\partial ', '∇': '\\nabla ', '√': '\\sqrt ', '∛': '\\sqrt[3] ', '∜': '\\sqrt[4] ',
  '∑': '\\sum ', '∏': '\\prod ', '∫': '\\int ', '∬': '\\iint ', '∭': '\\iiint ', '∮': '\\oint ',
  '∯': '\\oiint ', '∰': '\\oiiint ',
  '∈': '\\in ', '∉': '\\notin ', '∋': '\\ni ', '⊂': '\\subset ', '⊆': '\\subseteq ',
  '⊃': '\\supset ', '⊇': '\\supseteq ', '⊄': '\\not\\subset ', '⊈': '\\nsubseteq ',
  '∪': '\\cup ', '∩': '\\cap ', '∖': '\\setminus ', '∅': '\\emptyset ',
  '∀': '\\forall ', '∃': '\\exists ', '∄': '\\nexists ',
  '∧': '\\wedge ', '∨': '\\vee ', '¬': '\\neg ', '⊕': '\\oplus ', '⊗': '\\otimes ',
  '→': '\\to ', '←': '\\leftarrow ', '↔': '\\leftrightarrow ', '⇒': '\\Rightarrow ',
  '⇐': '\\Leftarrow ', '⇔': '\\Leftrightarrow ', '↦': '\\mapsto ', '↑': '\\uparrow ', '↓': '\\downarrow ',
  '∠': '\\angle ', '⊥': '\\perp ', '∥': '\\parallel ', '∦': '\\nparallel ', '°': '^{\\circ} ',
  '′': '\\prime ', '″': '\\prime\\prime ', '‴': '\\prime\\prime\\prime ',
  '⋯': '\\cdots ', '…': '\\dots ', '⋮': '\\vdots ', '⋱': '\\ddots ',
  '⌊': '\\lfloor ', '⌋': '\\rfloor ', '⌈': '\\lceil ', '⌉': '\\rceil ',
  '⟨': '\\langle ', '⟩': '\\rangle ', '‖': '\\| ',
  'ℕ': '\\mathbb{N} ', 'ℤ': '\\mathbb{Z} ', 'ℚ': '\\mathbb{Q} ', 'ℝ': '\\mathbb{R} ', 'ℂ': '\\mathbb{C} ',
  'α': '\\alpha ', 'β': '\\beta ', 'γ': '\\gamma ', 'δ': '\\delta ', 'ε': '\\epsilon ',
  'ζ': '\\zeta ', 'η': '\\eta ', 'θ': '\\theta ', 'ϑ': '\\vartheta ', 'ι': '\\iota ',
  'κ': '\\kappa ', 'λ': '\\lambda ', 'μ': '\\mu ', 'ν': '\\nu ', 'ξ': '\\xi ', 'π': '\\pi ',
  'ϖ': '\\varpi ', 'ρ': '\\rho ', 'σ': '\\sigma ', 'ς': '\\varsigma ', 'τ': '\\tau ',
  'υ': '\\upsilon ', 'φ': '\\phi ', 'ϕ': '\\varphi ', 'χ': '\\chi ', 'ψ': '\\psi ', 'ω': '\\omega ',
  'Γ': '\\Gamma ', 'Δ': '\\Delta ', 'Θ': '\\Theta ', 'Λ': '\\Lambda ', 'Ξ': '\\Xi ', 'Π': '\\Pi ',
  'Σ': '\\Sigma ', 'Υ': '\\Upsilon ', 'Φ': '\\Phi ', 'Ψ': '\\Psi ', 'Ω': '\\Omega '
}

// 正体函数名
const FUNCS = {
  sin: '\\sin', cos: '\\cos', tan: '\\tan', cot: '\\cot', sec: '\\sec', csc: '\\csc',
  arcsin: '\\arcsin', arccos: '\\arccos', arctan: '\\arctan',
  sinh: '\\sinh', cosh: '\\cosh', tanh: '\\tanh', coth: '\\coth',
  log: '\\log', ln: '\\ln', lg: '\\lg', exp: '\\exp',
  lim: '\\lim', max: '\\max', min: '\\min', sup: '\\sup', inf: '\\inf',
  det: '\\det', gcd: '\\gcd', lcm: '\\operatorname{lcm}', deg: '\\deg',
  dim: '\\dim', ker: '\\ker', arg: '\\arg', Pr: '\\Pr', mod: '\\bmod'
}
// 可带上下限的大运算符 / 函数
const BIGOP = {
  '∑': '\\sum', '∏': '\\prod', '∫': '\\int', '∬': '\\iint', '∭': '\\iiint',
  '∮': '\\oint', '⋃': '\\bigcup', '⋂': '\\bigcap', '⨁': '\\bigoplus',
  lim: '\\lim', max: '\\max', min: '\\min', sup: '\\sup', inf: '\\inf', det: '\\det'
}

function bigOpOf(node) {
  if (!node) return null
  if (node.name === '#text') return BIGOP[decodeEntities(node.text).trim()] || null
  if (kids(node).length === 1) return bigOpOf(kids(node)[0])
  const t = decodeEntities(textOf(node)).trim()
  return BIGOP[t] || null
}
function bare(node) {
  const s = mml(node)
  if (/^\\?[A-Za-z0-9]$/.test(s) || /^\\[a-zA-Z]+$/.test(s)) return s
  return '{' + s + '}'
}
function bracket(c) {
  if (c === '' || c == null) return '.'
  if (c === '{') return '\\{'
  if (c === '}') return '\\}'
  if (c === '⌊') return '\\lfloor '
  if (c === '⌋') return '\\rfloor '
  if (c === '⌈') return '\\lceil '
  if (c === '⌉') return '\\rceil '
  if (c === '⟨') return '\\langle '
  if (c === '⟩') return '\\rangle '
  if (c === '‖') return '\\| '
  return c
}
const ACCENT = {
  '^': '\\hat', 'ˆ': '\\hat', '→': '\\vec', '¯': '\\bar', '‾': '\\bar',
  '˜': '\\tilde', '~': '\\tilde', '˙': '\\dot', '¨': '\\ddot',
  '´': '\\acute', '`': '\\grave', 'ˇ': '\\check', '˘': '\\breve', '°': '\\mathring'
}

function moToLatex(t) {
  const s = String(t).trim()
  if (SYM[s]) return SYM[s]
  if (FUNCS[s]) return FUNCS[s] + ' '
  if (!s) return ''
  return esc(s)
}

// 公式文本处理：符号映射 + 函数名正体化（用于 MathML/OMML 的文本节点）
function mathText(s) {
  let t = decodeEntities(String(s == null ? '' : s))
  t = t.replace(/<=/g, '\\le ').replace(/>=/g, '\\ge ').replace(/!=/g, '\\ne ').replace(/->/g, '\\to ')
  t = t.replace(/[\s\S]/g, (c) => (SYM[c] ? SYM[c] : c))
  t = t.replace(/(^|[^a-zA-Z\\])(arcsin|arccos|arctan|sinh|cosh|tanh|sin|cos|tan|cot|sec|csc|log|ln|lg|exp|lim|max|min|sup|inf|det|gcd|mod)(?![a-zA-Z])/g,
    (_, pre, fn) => pre + (FUNCS[fn] || fn) + ' ')
  return t
}

function mtableRows(node) {
  return kids(node).filter((c) => local(c.name) === 'mtr')
    .map((r) => kids(r).filter((c) => local(c.name) === 'mtd').map((c) => c.children.map(mml).join('')))
}

// ---------------- MathML ----------------
function mml(node) {
  if (!node) return ''
  if (node.name === '#text') return ''
  const n = local(node.name)
  const ch = kids(node)
  switch (n) {
    case 'math': case 'mrow': case 'mstyle': case 'mpadded': case 'mphantom':
    case 'semantics': case 'annotation': case 'mspace2':
      return ch.map(mml).join('')
    case 'mi': {
      const raw = decodeEntities(textOf(node)).trim()
      if (FUNCS[raw]) return FUNCS[raw] + ' '
      return mathText(raw)
    }
    case 'mn': return mathText(decodeEntities(textOf(node)).trim())
    case 'mo': return moToLatex(decodeEntities(textOf(node)))
    case 'mtext': return '\\text{' + esc(decodeEntities(textOf(node))) + '}'
    case 'mspace': return '\\,'
    case 'mfrac': {
      if (/^0(\.0+)?$/.test(String(node.attrs.linethickness || ''))) {
        return '\\binom{' + (ch[0] ? mml(ch[0]) : '') + '}{' + (ch[1] ? mml(ch[1]) : '') + '}'
      }
      return '\\frac{' + (ch[0] ? mml(ch[0]) : '') + '}{' + (ch[1] ? mml(ch[1]) : '') + '}'
    }
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
    case 'mmultiscripts': {
      // 简化为普通上下标
      let out = bare(ch[0])
      const rest = ch.slice(1)
      for (let i = 0; i + 1 < rest.length; i += 2) {
        if (local(rest[i].name) === 'mprescripts') break
        out += '_{' + mml(rest[i]) + '}^{' + mml(rest[i + 1]) + '}'
      }
      return out
    }
    case 'msqrt': return '\\sqrt{' + ch.map(mml).join('') + '}'
    case 'mroot': return '\\sqrt[' + (ch[1] ? mml(ch[1]) : '') + ']{' + (ch[0] ? mml(ch[0]) : '') + '}'
    case 'mfenced': {
      const open = decodeEntities(node.attrs.open !== undefined ? node.attrs.open : '(')
      const close = decodeEntities(node.attrs.close !== undefined ? node.attrs.close : ')')
      const inner = ch.filter((c) => c.name !== '#text' || c.text.trim())
      // 二项式：括号内是 linethickness=0 的分式 → \binom，避免多一层括号
      if (inner.length === 1 && local(inner[0].name) === 'mfrac' &&
          /^0(\.0+)?$/.test(String(inner[0].attrs.linethickness || ''))) {
        const f = inner[0]
        return '\\binom{' + mml(f.children[0]) + '}{' + mml(f.children[1]) + '}'
      }
      if (inner.length === 1 && local(inner[0].name) === 'mtable') {
        const rows = mtableRows(inner[0])
        const body = rows.map((r) => r.join(' & ')).join(' \\\\ ')
        if (open === '{' && !close) return '\\begin{cases}' + body + '\\end{cases}'
        return '\\left' + bracket(open) + '\\begin{matrix}' + body + '\\end{matrix}\\right' + bracket(close)
      }
      return '\\left' + bracket(open) + inner.map(mml).join('') + '\\right' + bracket(close)
    }
    case 'mover': {
      const bo = bigOpOf(ch[0])
      if (bo) return bo + '^{' + (ch[1] ? mml(ch[1]) : '') + '}'
      const a = ch[1] ? ACCENT[decodeEntities(textOf(ch[1])).trim()] : ''
      if (a === '\\bar') return '\\overline{' + mml(ch[0]) + '}'
      if (a) return a + '{' + mml(ch[0]) + '}'
      return '\\overset{' + (ch[1] ? mml(ch[1]) : '') + '}{' + (ch[0] ? mml(ch[0]) : '') + '}'
    }
    case 'munder': {
      const bo = bigOpOf(ch[0])
      if (bo) return bo + '_{' + (ch[1] ? mml(ch[1]) : '') + '}'
      const a = ch[1] ? ACCENT[decodeEntities(textOf(ch[1])).trim()] : ''
      if (a === '\\bar') return '\\underline{' + mml(ch[0]) + '}'
      return '\\underset{' + (ch[1] ? mml(ch[1]) : '') + '}{' + (ch[0] ? mml(ch[0]) : '') + '}'
    }
    case 'munderover': {
      const bo = bigOpOf(ch[0])
      if (bo) return bo + '_{' + (ch[1] ? mml(ch[1]) : '') + '}^{' + (ch[2] ? mml(ch[2]) : '') + '}'
      return '\\overset{' + (ch[2] ? mml(ch[2]) : '') + '}{\\underset{' + (ch[1] ? mml(ch[1]) : '') + '}{' + (ch[0] ? mml(ch[0]) : '') + '}}'
    }
    case 'menclose': {
      const notation = String(node.attrs.notation || '')
      const inner = ch.map(mml).join('')
      if (/updiagonalstrike|downdiagonalstrike/.test(notation)) return '\\cancel{' + inner + '}'
      if (/box/.test(notation)) return '\\boxed{' + inner + '}'
      return inner
    }
    case 'mtable': {
      const rows = mtableRows(node)
      return '\\begin{matrix}' + rows.map((r) => r.join(' & ')).join(' \\\\ ') + '\\end{matrix}'
    }
    case 'mtr': return kids(node).filter((c) => local(c.name) === 'mtd').map((c) => c.children.map(mml).join('')).join(' & ')
    case 'mtd': return ch.map(mml).join('')
    default: return ch.map(mml).join('')
  }
}

// ---------------- OMML (Word / WPS) ----------------
function omml(node) {
  if (!node) return ''
  if (node.name === '#text') return ''
  const n = local(node.name)
  const ch = kids(node)
  const pick = (name) => ch.find((c) => local(c.name) === name)
  const all = (name) => ch.filter((c) => local(c.name) === name)
  const valOf = (el) => (el ? (el.attrs['m:val'] !== undefined ? el.attrs['m:val'] : (el.attrs.val !== undefined ? el.attrs.val : '')) : '')
  switch (n) {
    case 'omath': case 'omathpara': case 'e': case 'num': case 'den': case 'sub': case 'sup':
    case 'deg': case 'fname': case 'box': case 'phant':
      return ch.map(omml).join('')
    case 'r': return all('t').map((t) => mathText(textOf(t))).join('')
    case 't': return mathText(textOf(node))
    case 'f': {
      const num = pick('num'), den = pick('den')
      const pr = pick('fpr')
      if (pr && /0/.test(valOf(kids(pr).find((c) => local(c.name) === 'type')) || '')) {
        return '\\binom{' + (num ? omml(num) : '') + '}{' + (den ? omml(den) : '') + '}'
      }
      return '\\frac{' + (num ? omml(num) : '') + '}{' + (den ? omml(den) : '') + '}'
    }
    case 'ssup': return brace(pick('e')) + '^{' + (pick('sup') ? omml(pick('sup')) : '') + '}'
    case 'ssub': return brace(pick('e')) + '_{' + (pick('sub') ? omml(pick('sub')) : '') + '}'
    case 'ssubsup': return brace(pick('e')) + '_{' + (pick('sub') ? omml(pick('sub')) : '') + '}^{' + (pick('sup') ? omml(pick('sup')) : '') + '}'
    case 'spre': return '^{' + (pick('sup') ? omml(pick('sup')) : '') + '}_{' + (pick('sub') ? omml(pick('sub')) : '') + '}' + brace(pick('e'))
    case 'rad': {
      const deg = pick('deg'), e = pick('e')
      const d = deg ? omml(deg) : ''
      return d ? '\\sqrt[' + d + ']{' + (e ? omml(e) : '') + '}' : '\\sqrt{' + (e ? omml(e) : '') + '}'
    }
    case 'd': {
      const pr = pick('dpr')
      let open = '(', close = ')'
      if (pr) {
        const bp = kids(pr).find((c) => local(c.name) === 'begchr')
        const ep = kids(pr).find((c) => local(c.name) === 'endchr')
        if (bp) open = valOf(bp)
        if (ep) close = valOf(ep)
      }
      const inner = all('e').map(omml).join('')
      if (open === '{' && !close) {
        // 分段函数：去掉内层 aligned 包裹，直接用 cases
        const body = inner.replace(/^\\begin\{aligned\}/, '').replace(/\\end\{aligned\}$/, '')
        return '\\begin{cases}' + body + '\\end{cases}'
      }
      return '\\left' + bracket(open) + inner + '\\right' + bracket(close)
    }
    case 'nary': {
      const pr = pick('narypr')
      let chr = '\\int '
      if (pr) {
        const c = valOf(kids(pr).find((x) => local(x.name) === 'chr'))
        if (c) chr = (SYM[c] || c) + ' '
      }
      const sub = pick('sub'), sup = pick('sup'), e = pick('e')
      let out = chr
      if (sub) out += '_{' + omml(sub) + '}'
      if (sup) out += '^{' + omml(sup) + '}'
      if (e) out += omml(e)
      return out
    }
    case 'func': {
      const fnNode = pick('fname')
      const fnName = fnNode ? decodeEntities(textOf(fnNode)).trim() : ''
      const cmd = FUNCS[fnName] || null
      const low = pick('limlow'), up = pick('limupp')
      const e = pick('e')
      if (cmd && (low || up)) {
        let out = cmd
        if (low) out += '_{' + omml(pick2(low, 'lim') || low) + '}'
        if (up) out += '^{' + omml(pick2(up, 'lim') || up) + '}'
        if (e) out += omml(e)
        return out
      }
      const head = cmd ? cmd + ' ' : (fnNode ? omml(fnNode) : '')
      return head + (e ? '\\left(' + omml(e) + '\\right)' : '')
    }
    case 'limlow': {
      const base = pick('e'), lim = pick('lim')
      const bcmd = bigOpOf(base)
      if (bcmd) return bcmd + '_{' + (lim ? omml(lim) : '') + '}'
      return '\\underset{' + (lim ? omml(lim) : '') + '}{' + (base ? omml(base) : '') + '}'
    }
    case 'limupp': {
      const base = pick('e'), lim = pick('lim')
      const bcmd = bigOpOf(base)
      if (bcmd) return bcmd + '^{' + (lim ? omml(lim) : '') + '}'
      return '\\overset{' + (lim ? omml(lim) : '') + '}{' + (base ? omml(base) : '') + '}'
    }
    case 'acc': {
      const pr = pick('accpr'), e = pick('e')
      const c = valOf(kids(pr || { children: [] }).find((x) => local(x.name) === 'chr'))
      const cmd = ACCENT[c] || '\\hat'
      if (cmd === '\\bar') return '\\overline{' + (e ? omml(e) : '') + '}'
      return cmd + '{' + (e ? omml(e) : '') + '}'
    }
    case 'bar': {
      const e = pick('e')
      const pos = valOf(kids(pick('barpr') || { children: [] }).find((x) => local(x.name) === 'pos'))
      return (pos === 'bot' ? '\\underline{' : '\\overline{') + (e ? omml(e) : '') + '}'
    }
    case 'groupchr': {
      const e = pick('e')
      const pos = valOf(kids(pick('groupchrpr') || { children: [] }).find((x) => local(x.name) === 'pos'))
      return (pos === 'top' ? '\\overbrace{' : '\\underbrace{') + (e ? omml(e) : '') + '}'
    }
    case 'borderbox': { const e = pick('e'); return '\\boxed{' + (e ? omml(e) : '') + '}' }
    case 'eqarr': {
      const es = all('e')
      return '\\begin{aligned}' + es.map((x) => omml(x)).join(' \\\\ ') + '\\end{aligned}'
    }
    case 'm': {
      const rows = all('mr')
      return '\\begin{matrix}' + rows.map((r) => all2(r, 'e').map(omml).join(' & ')).join(' \\\\ ') + '\\end{matrix}'
    }
    case 'mr': return all('e').map(omml).join(' & ')
    default: return ch.map(omml).join('')
  }
}
function pick2(node, name) {
  return kids(node).find((c) => local(c.name) === name)
}
function all2(node, name) {
  return kids(node).filter((c) => local(c.name) === name)
}
function brace(node) {
  if (!node) return ''
  const s = omml(node)
  if (/^\\?[A-Za-z0-9]$/.test(s) || /^\\[a-zA-Z]+$/.test(s)) return s
  return '{' + s + '}'
}

// ---------------- HTML 兜底（Word/WPS 的 HTML 公式结构） ----------------
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
  s = s.replace(/([∑∏∫√≤≥≠±×÷∞∂∇∈∪∩→←↔⇒⇔αβγδεζηθικλμνξπρστυφχψωΓΔΘΛΞΠΣΦΨΩ∧∨¬′⌊⌋⌈⌉⟨⟩])/g, (c) => SYM[c] || c)
  return s.replace(/\s+/g, ' ').trim()
}

// ---------------- 提取与对外接口 ----------------
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
    .replace(/(\\[a-zA-Z]+) +(?=[_^{}\]])/g, '$1')
    .replace(/\\left\s*\\right/g, '')
    .trim()
}

function isFormulaText(t) {
  if (/\\[a-zA-Z]{2,}/.test(t)) return true
  if (/[∑∏∫√∞≠≤≥±∓]/.test(t)) return true
  if (/\^/.test(t) && /[a-zA-Z0-9]/.test(t)) return true
  if (/[a-zA-Z0-9]\s*\/\s*[a-zA-Z0-9(]/.test(t) && /[∫∑√∏]|[a-zA-Z]_[a-zA-Z0-9]/.test(t)) return true
  return false
}

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
  // 2) OMML（RTF 里可能是转义形式）
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
  // 4) 纯文本本身就是公式（AI 聊天给的 LaTeX 源码 / 线性公式）
  try {
    const t = String(plain || '').trim()
    if (t && t.length <= 2000 && isFormulaText(t)) return clean(t)
  } catch {}
  return ''
}

module.exports = {
  toLatex, parseXml, mmlToLatex: mml, ommlToLatex: omml,
  extractMathml, extractOmml, htmlToLatex, isFormulaText
}
