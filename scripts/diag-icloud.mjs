import {readdirSync,readFileSync,statSync} from 'node:fs';import {join} from 'node:path';
const base=process.env.HOME+'/Library/Mobile Documents/com~apple~CloudDocs';
const res={err:{},ex:[]};let n=0;
function w(d,depth=0){let es;try{es=readdirSync(d,{withFileTypes:true})}catch(e){const k='DIR '+(e.code||e.message.slice(0,50));res.err[k]=(res.err[k]||0)+1;res.ex.push(d);return}
for(const e of es){if(n>300)return;if(e.name.startsWith('.'))continue;const p=join(d,e.name);if(e.isDirectory())w(p,depth+1);else if(e.isFile()){n++;try{readFileSync(p)}catch(x){const k=x.code||x.message.slice(0,50);res.err[k]=(res.err[k]||0)+1;if(res.ex.length<6)res.ex.push(p)}}}}
w(base);console.log(JSON.stringify({files:n,...res},null,1));
