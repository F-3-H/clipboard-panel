// MathML / OMML -> LaTeX 转换测试
const { toLatex } = require('../latex')

const cases = [
  { name: 'MathML 分数', html: '<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>' },
  { name: 'MathML 上标', html: '<math><msup><mi>x</mi><mn>2</mn></msup></math>' },
  { name: 'MathML 下标', html: '<math><msub><mi>a</mi><mi>n</mi></msub></math>' },
  { name: 'MathML 根号', html: '<math><msqrt><mi>x</mi><mo>+</mo><mn>1</mn></msqrt></math>' },
  { name: 'MathML 求和(上下限)', html: '<math><munderover><mo>&#8721;</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover><msup><mi>i</mi><mn>2</mn></msup></math>' },
  { name: 'MathML 希腊+括号', html: '<math><mi>π</mi><msup><mi>r</mi><mn>2</mn></msup><mo>=</mo><mi>A</mi></math>' },
  { name: 'MathML 分式嵌套', html: '<math><mfrac><mrow><mo>(</mo><mi>a</mi><mo>+</mo><mi>b</mi><mo>)</mo></mrow><mn>2</mn></mfrac></math>' },
  { name: 'OMML 分数', rtf: '<m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>' },
  { name: 'OMML 根号+上标', rtf: '<m:oMath><m:rad><m:deg/><m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad><m:sSup><m:e><m:r><m:t>y</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>' },
  { name: 'OMML 积分', rtf: '<m:oMath><m:nary><m:naryPr><m:chr m:val="∫"/></m:naryPr><m:sub><m:r><m:t>0</m:t></m:r></m:sub><m:sup><m:r><m:t>1</m:t></m:r></m:sup><m:e><m:r><m:t>x</m:t></m:r></m:e></m:nary></m:oMath>' }
]

for (const c of cases) {
  const out = toLatex(c)
  console.log(c.name + '  =>  ' + (out || '(空)'))
}
