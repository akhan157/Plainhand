// Synthetic packet only. This is also the entry point for the isolated traced bundle.
import assert from 'node:assert/strict';
import { Workspace } from '../../plainhand/store.mjs';
import { MemoryStorage } from '../../plainhand/storage.mjs';
import { renderCloudPacket } from '../../plainhand/cloud/runtime.mjs';
const workspace = new Workspace(null, {storage:new MemoryStorage()});
for (const phase of ['cold','warm']) {
 const start=performance.now();
 const result=await renderCloudPacket(workspace,{profile:{name:'Synthetic Candidate',location:'Remote'}},{company:'Synthetic',title:'Engineer',url:'https://example.invalid',description:'Synthetic',reportPath:'reports/synthetic.md'},{resume:[{section:'Experience',text:'Built test systems.'}],coverLetter:'Synthetic cover letter.',answers:[]});
 const sizes=[];
 for(const file of result.artifacts.filter(p=>p.endsWith('.pdf'))) {const bytes=await workspace.readBinary(file);assert.equal(bytes.subarray(0,5).toString(),'%PDF-');sizes.push(bytes.length);}
 console.log(JSON.stringify({phase,ms:Math.round(performance.now()-start),pdfBytes:sizes}));
}
