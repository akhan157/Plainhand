// Reproducible dependency tracing check, not a substitute for `vercel build`.
import {nodeFileTrace} from '@vercel/nft';
import {cp, mkdir, readdir, stat, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(), destination=path.join(root,'tmp/hosted-trace');
await rm(destination,{recursive:true,force:true});
const {fileList,warnings}=await nodeFileTrace(['api/index.mjs','scripts/cloud/render-smoke.mjs'],{base:root,processCwd:root});
async function include(directory) {
 for(const entry of await readdir(directory,{withFileTypes:true})) {const name=path.join(directory,entry.name);if(entry.isDirectory())await include(name);else fileList.add(name);}
}
await include('plainhand/web');
await include('node_modules/@sparticuz/chromium/bin');
fileList.add('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
let bytes=0;
for(const file of fileList) {const target=path.join(destination,file);await mkdir(path.dirname(target),{recursive:true});await cp(file,target,{dereference:true});bytes+=(await stat(file)).size;}
for(const file of ['chromium.br','fonts.tar.br','al2023.tar.br','swiftshader.tar.br'])assertPresent('node_modules/@sparticuz/chromium/bin/'+file);
function assertPresent(file){if(!fileList.has(file))throw new Error('Missing required runtime asset: '+file);}
assertPresent('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
if(bytes>=250*1024*1024)throw new Error('Trace exceeds Vercel 250 MB function limit.');
await writeFile('tmp/hosted-trace-manifest.json',JSON.stringify({bytes,files:fileList.size,warnings:[...warnings].map(w=>w.message)},null,2));
console.log(JSON.stringify({bytes,files:fileList.size,warnings:warnings.size,destination:'tmp/hosted-trace'}));
