// 常见数学形式的转换覆盖测试
const { toLatex } = require('../latex')

const cases = [
  ['极限 MathML(munder)', '<math><munder><mo>lim</mo><mrow><mi>x</mi><mo>&#8594;</mo><mn>0</mn></mrow></munder><mfrac><mrow><mi>sin</mi><mi>x</mi></mrow><mi>x</mi></mfrac></math>'],
  ['极限 OMML(func+limLow)', '<m:oMath><m:func><m:fName><m:r><m:t>lim</m:t></m:r></m:fName><m:limLow><m:e><m:r><m:t>lim</m:t></m:r></m:e><m:lim><m:r><m:t>x&#8594;0</m:t></m:r></m:lim></m:limLow></m:func><m:f><m:num><m:r><m:t>sin x</m:t></m:r></m:num><m:den><m:r><m:t>x</m:t></m:r></m:den></m:f></m:oMath>'],
  ['极限 OMML(limLow 独立)', '<m:oMath><m:limLow><m:e><m:r><m:t>lim</m:t></m:r></m:e><m:lim><m:r><m:t>x&#8594;0</m:t></m:r></m:lim></m:limLow></m:oMath>'],
  ['导数', '<math><msup><mi>f</mi><mo>&#8242;</mo></msup><mo>(</mo><mi>x</mi><mo>)</mo><mo>=</mo><mfrac><mrow><mi>d</mi><mi>f</mi></mrow><mrow><mi>d</mi><mi>x</mi></mrow></mfrac></math>'],
  ['偏导', '<math><mfrac><mrow><mo>&#8706;</mo><mi>f</mi></mrow><mrow><mo>&#8706;</mo><mi>x</mi></mrow></mfrac></math>'],
  ['矩阵', '<math><mfenced open="[" close="]"><mtable><mtr><mtd><mi>a</mi></mtd><mtd><mi>b</mi></mtd></mtr><mtr><mtd><mi>c</mi></mtd><mtd><mi>d</mi></mtd></mtr></mtable></mfenced></math>'],
  ['分段函数', '<math><mfenced open="{" close=""><mtable><mtr><mtd><mn>1</mn></mtd><mtd><mi>x</mi><mo>&gt;</mo><mn>0</mn></mtd></mtr><mtr><mtd><mn>0</mn></mtd><mtd><mi>x</mi><mo>&#8804;</mo><mn>0</mn></mtd></mtr></mtable></mfenced></math>'],
  ['帽子与向量', '<math><mover accent="true"><mi>x</mi><mo>^</mo></mover><mover accent="true"><mi>a</mi><mo>&#8594;</mo></mover></math>'],
  ['上划线', '<math><mover accent="true"><mi>x</mi><mo>&#175;</mo></mover></math>'],
  ['定积分', '<math><msubsup><mo>&#8747;</mo><mn>0</mn><mn>1</mn></msubsup><msup><mi>x</mi><mn>2</mn></msup><mi>d</mi><mi>x</mi></math>'],
  ['二重积分', '<math><msub><mo>&#8748;</mo><mi>D</mi></msub><mi>f</mi><mi>d</mi><mi>A</mi></math>'],
  ['n 次根', '<math><mroot><mi>x</mi><mn>3</mn></mroot></math>'],
  ['绝对值', '<math><mfenced open="|" close="|"><mi>x</mi></mfenced></math>'],
  ['下取整', '<math><mfenced open="&#8970;" close="&#8971;"><mi>x</mi></mfenced></math>'],
  ['二项式', '<math><mfenced open="(" close=")"><mfrac linethickness="0"><mi>n</mi><mi>k</mi></mfrac></mfenced></math>'],
  ['集合与逻辑', '<math><mi>x</mi><mo>&#8712;</mo><mi>A</mi><mo>&#8743;</mo><mi>y</mi><mo>&#8804;</mo><mi>B</mi></math>'],
  ['箭头', '<math><mi>f</mi><mo>:</mo><mi>A</mi><mo>&#8594;</mo><mi>B</mi></math>'],
  ['上标下标组合', '<math><msubsup><mi>x</mi><mi>i</mi><mn>2</mn></msubsup></math>'],
  ['矩阵 OMML(d+m)', '<m:oMath><m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/></m:dPr><m:e><m:m><m:mr><m:e><m:r><m:t>a</m:t></m:r></m:e><m:e><m:r><m:t>b</m:t></m:r></m:e></m:mr><m:mr><m:e><m:r><m:t>c</m:t></m:r></m:e><m:e><m:r><m:t>d</m:t></m:r></m:e></m:mr></m:m></m:e></m:d></m:oMath>'],
  ['OMML 上标', '<m:oMath><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>'],
  ['OMML 矩阵带括号', '<m:oMath><m:d><m:dPr><m:begChr m:val="{"/><m:endChr m:val=""/></m:dPr><m:e><m:eqArr><m:e><m:r><m:t>x&gt;0</m:t></m:r></m:e><m:e><m:r><m:t>x&lt;=0</m:t></m:r></m:e></m:eqArr></m:e></m:d></m:oMath>']
]

for (const [name, xml] of cases) {
  const out = toLatex({ html: xml }) || toLatex({ rtf: xml }) || ''
  console.log(name.padEnd(24) + ' => ' + (out || '(空)'))
}
