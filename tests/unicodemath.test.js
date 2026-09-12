// LaTeX -> UnicodeMath（Word 公式编辑器线性格式）转换测试
const { toUnicodeMath } = require('../latex')

const cases = [
  '\\sum_{n=-\\infty}^{\\infty} c_n (z-z_0)',
  '\\lim_{x \\to 0}\\frac{\\sin x}{x}',
  'c_n=\\operatorname{Res}((z-a)^{n+1}f(z),a)',
  '2\\pi i\\sum \\operatorname{Res}(f, a_k)',
  '\\oint g(z)dz',
  '\\frac{a+b}{c}',
  '\\sqrt[3]{x}',
  '\\int_{0}^{1} x^{2} dx',
  '\\iint_{D} f dA',
  '\\begin{cases}1 & x>0 \\\\ 0 & x\\le 0\\end{cases}',
  '\\begin{pmatrix}a & b \\\\ c & d\\end{pmatrix}',
  '\\begin{bmatrix}a & b \\\\ c & d\\end{bmatrix}',
  'x^2 + y^2 = r^2',
  '\\hat{x}\\vec{a}\\overline{z}\\dot{y}',
  '\\alpha\\beta\\gamma + \\pi r^2',
  '\\frac{\\partial f}{\\partial x}',
  "f'(x)=\\frac{df}{dx}",
  '\\binom{n}{k}',
  '\\left\\lfloor x \\right\\rfloor',
  'A \\cup B \\subseteq C \\Rightarrow x \\in D',
  '\\sqrt{x^2+y^2}'
]

for (const src of cases) {
  console.log(src.padEnd(52) + ' => ' + toUnicodeMath(src))
}
