const fs=require('fs'),vm=require('vm'),path=require('path');
const root=path.resolve(__dirname,'../..');
const src=fs.readFileSync(path.join(root,'server/scripts/import-words.js'),'utf8');
const context={require,process:{argv:[]},__dirname:path.join(root,'server/scripts')};
vm.createContext(context);
vm.runInContext(src.slice(0,src.indexOf('const loadEnv')).replace("const { PrismaClient } = require('@prisma/client')",'')+'\nthis.convert=arpabetToKK;this.collect=collectCmudict;',context);
const rows=JSON.parse(require('child_process').execFileSync('python3',['-c',`import sqlite3,json; c=sqlite3.connect('file:${root}/server/data/flashnext.db?mode=ro',uri=True); print(json.dumps(list(c.execute('select headword,phonetic from words'))))`],{encoding:'utf8'}));
const original=context.collect(rows.map(([headword])=>({headword})));
const cmu=new Map();for(const line of fs.readFileSync(path.join(root,'server/scripts/data/cmudict.txt'),'utf8').split('\n')){const m=line.match(/^(\S+)\s+(.+)$/);if(!m||line.startsWith(';;;'))continue;const k=m[1].toLowerCase().replace(/\(\d+\)$/,'');if(!cmu.has(k))cmu.set(k,m[2]);}
let match=0,available=0;for(const [w,p] of rows){if(cmu.has(w.toLowerCase())){available++;if(context.convert(cmu.get(w.toLowerCase()))===p)match++;}}
const out={total:rows.length,current_parser_matches:original.size,whitespace_compatible_parser_available:available,current_equals_conversion:match};
fs.writeFileSync(path.join(__dirname,'cmu-reproduction.json'),JSON.stringify(out,null,2));console.log(out);
