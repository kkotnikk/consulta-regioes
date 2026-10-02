import assert from 'node:assert/strict';
import {identificarTotalColetas,lerTotalRodape} from './relatorio-total-coletas.mjs';

const util={Util:{transform:(_viewport,item)=>[1,0,0,1,item[4],842-item[5]]}};
const item=(str,y)=>({str,transform:[1,0,0,1,40,y]});
const folha=(items=[])=>({
 getViewport({scale}){return {width:595*scale,height:842*scale,transform:[]}},
 async getTextContent(){return {items}},
 render(){return {promise:Promise.resolve()}},
});
const documento=ultima=>({
 numPages:2,async getPage(n){if(n===1)throw new Error('A primeira página não deve ser lida.');return ultima},
});
const tsv=total=>'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t40\t2\t30\t20\t94\t'+total;
const modos=[];
let textoOcr='';
globalThis.window={Tesseract:{async createWorker(){return {
 async setParameters({tessedit_pageseg_mode:modo}){modos.push(modo)},
 async recognize(){return {data:{text:textoOcr,tsv:tsv(24)}}},
 async terminate(){},
}}}};
globalThis.document={createElement(){return {
 width:0,height:0,getContext(){return {drawImage(){}}},
}}};

assert.equal(identificarTotalColetas('TOTAL: 24 COLETAS -').total,24);
assert.deepEqual(await lerTotalRodape(documento(folha([item('TOTAL: 24 COLETAS',20)])),util,()=>{}),{total:24,origem:'texto'});
assert.deepEqual(await lerTotalRodape(documento(folha([item('Total: 24 coletas',730)])),util,()=>{}),{total:24,origem:'texto'});
textoOcr='Página 2';
assert.deepEqual(await lerTotalRodape(documento(folha([item('TOTAL: 999 COLETAS',730),item('TOTAL: 24 COLETAS',600)])),util,()=>{}),{total:null,motivo:'ambiguo'});
textoOcr='Página 2';modos.length=0;
assert.deepEqual(await lerTotalRodape(documento(folha([item('Página 2',20)])),util,()=>{}),{total:null,motivo:'ausente'});
assert.deepEqual(modos,['6','11']);
let leituras=0;
window.Tesseract.createWorker=async()=>({
 async setParameters({tessedit_pageseg_mode:modo}){modos.push(modo)},
 async recognize(){leituras++;return {data:{text:leituras===1?'Página 2':'TOTAL: 24 COLETAS -',tsv:tsv(24)}}},
 async terminate(){},
});
modos.length=0;
assert.deepEqual(await lerTotalRodape(documento(folha([item('Página 2',20)])),util,()=>{}),{total:24,origem:'ocr'});
assert.deepEqual(modos,['6','11']);
console.log('OK: última página, corpo ignorado, rodapé em imagem e segunda passagem OCR.');
