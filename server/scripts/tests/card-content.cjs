const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const esbuild = require('../../node_modules/esbuild')
require('reflect-metadata')
const outfile = path.resolve(__dirname, '../../node_modules/.cache/content-tests.cjs')
fs.mkdirSync(path.dirname(outfile), {recursive:true})
esbuild.buildSync({entryPoints:[path.resolve(__dirname,'../../app/modules/content/application/content.service.ts')],bundle:true,platform:'node',format:'cjs',packages:'external',outfile,tsconfig:path.resolve(__dirname,'../../tsconfig.json')})
const {ContentService}=require(outfile)
const content=new ContentService()
test('plain preserves text, newline, prices and raw formula sources without interpreting HTML',()=>{
 const source='<img src=x onerror=alert(1)>\nCost $10; \\(x^2\\)'
 const r=content.preview({contentFormat:'plain',front:source})
 assert.equal(r.valid,true);assert.match(r.front.html,/&lt;img/);assert.match(r.front.html,/<br>/)
 assert.doesNotMatch(r.front.html,/class="katex"/)
})
test('Markdown and inline/display formulas render HTML and MathML',()=>{
 for(const source of ['**公式** \\(a^2+b^2=c^2\\)','before\n\n$$\\frac{1}{2}$$\n\nafter','\\[\\int_0^1 x^2 \\, dx\\]','text $$x^2$$ then text','- \\(x^2\\)']){
  const r=content.preview({front:source});assert.equal(r.valid,true,JSON.stringify(r.front.errors));assert.match(r.front.html,/class="katex/);assert.match(r.front.html,/<math/)
 }
})
test('code fences and inline code do not interpret formulas; single dollar prices remain text',()=>{
 const r=content.preview({front:'`\\(x\\)`\n\n```tex\n$$\\bad$$\n```\n\nCost $10 and $20'})
 assert.equal(r.valid,true);assert.doesNotMatch(r.front.html,/class="katex"/);assert.match(r.front.html,/Cost \$10/)
})
test('invalid and unclosed formulas return locations; writes reject them',()=>{
 for(const front of ['line 1\n\n\\(\\notACommand{x}\\)','$$x','\\(x','\\[x','\\(\\frac{1}\\)']){
  const r=content.preview({front});assert.equal(r.valid,false,front);assert(r.front.errors[0].line>=1);assert(r.front.errors[0].column>=1)
  assert.throws(()=>content.validateCard(front,'answer','markdown_math'), e=>e.httpCode===422)
 }
 const r=content.preview({front:'line 1\n\n\\(\\notACommand{x}\\)'})
 assert.equal(r.front.errors[0].line,3);assert.equal(r.front.errors[0].column,1)
})
test('HTML, JavaScript links and trusted TeX commands never become active content',()=>{
 const r=content.preview({front:'<script>alert(1)</script> [x](javascript:alert(1)) <img src=x onerror=alert(1)>'})
 assert.doesNotMatch(r.front.html,/<script|<img|href="javascript:/i)
 for(const front of ['\\(\\href{javascript:alert(1)}{x}\\)','\\(\\includegraphics{file:///etc/passwd}\\)','\\(\\htmlStyle{color:red}{x}\\)']) assert.equal(content.preview({front}).valid,false)
})
test('macros are isolated between cards and content limits are enforced',()=>{
 assert.equal(content.preview({front:'\\(\\gdef\\myVar{abc}\\myVar\\)'}).valid,true)
 assert.equal(content.preview({front:'\\(\\myVar\\)'}).valid,false)
 assert.equal(content.preview({front:'\\('+ 'x'.repeat(4001)+'\\)'}).valid,false)
 assert.throws(()=>content.preview({front:'x'.repeat(100001)}),e=>e.httpCode===400)
 assert.throws(()=>content.preview({contentFormat:'html',front:'x'}),e=>e.httpCode===400)
})
