// Totais explícitos do rodapé; não conte endereços, pedidos ou linhas da tabela.
export function identificarTotalColetas(texto) {
 const fonte=String(texto||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
 const valores=[];
 const padroes=[/\bTOTAL(?:\s+GERAL)?\s*(?::|=|-(?=\s))?\s*(\d{1,3}(?:\.\d{3})*|\d+)\s*COLETAS?\b/g,/\bTOTAL(?:\s+GERAL)?\s+(?:DE\s+)?COLETAS?\s*(?::|=|-(?=\s))?\s*(\d{1,3}(?:\.\d{3})*|\d+)\b/g];
 for(const padrao of padroes)for(const match of fonte.matchAll(padrao)){
  const total=Number(match[1].replace(/\./g,''));if(Number.isInteger(total)&&total>=0&&total<=1000000)valores.push(total);
 }
 const distintos=[...new Set(valores)];
 return {total:distintos.length===1?distintos[0]:null,ambiguo:distintos.length>1};
}

export function textoRodape(items,viewport,transformar) {
 const palavras=items.filter(item=>item.str?.trim()&&item.transform).map(item=>{
  const pos=transformar(viewport.transform,item.transform);
  return {texto:item.str,x:pos[4],y:pos[5]};
 }).filter(item=>item.y>=viewport.height*.70&&item.y<=viewport.height+2);
 const linhas=[];
 for(const item of palavras.sort((a,b)=>a.y-b.y||a.x-b.x)){
  let linha=linhas.find(linha=>Math.abs(linha.y-item.y)<=3);
  if(!linha){linha={y:item.y,itens:[]};linhas.push(linha);}linha.itens.push(item);
 }
 return linhas.map(linha=>linha.itens.sort((a,b)=>a.x-b.x).map(item=>item.texto).join(' ')).join('\n');
}

let carregamentoOcr=null;
function carregarOcr() {
 if(window.Tesseract)return Promise.resolve(window.Tesseract);
 if(!carregamentoOcr)carregamentoOcr=new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';
  script.onload=()=>resolve(window.Tesseract);script.onerror=()=>{script.remove();carregamentoOcr=null;reject(new Error('Não foi possível iniciar a leitura do rodapé.'))};document.head.append(script);
 });return carregamentoOcr;
}

export async function lerTotalRodape(documento,pdfjs,informar,cancelado=()=>false) {
 const paginasSemTexto=[];let candidatoTexto=null;
 // O rodapé da última folha tem prioridade para o total do relatório completo.
 for(let numero=documento.numPages;numero>=1;numero--){
  if(cancelado())throw new Error('Leitura cancelada.');
  const page=await documento.getPage(numero),viewport=page.getViewport({scale:1}),{items}=await page.getTextContent();
  const texto=textoRodape(items,viewport,pdfjs.Util.transform),resultado=identificarTotalColetas(texto);
  if(resultado.ambiguo)return {total:null,motivo:'ambiguo'};
  if(resultado.total!==null){candidatoTexto={total:resultado.total,origem:'texto'};if(!paginasSemTexto.length)return candidatoTexto;break;}
  // O corpo/numeração pode ser texto selecionável enquanto o total é uma imagem.
  // Sem um total explícito, examine também a imagem do rodapé desta folha.
  paginasSemTexto.push(page);
 }
 // Digitalizações são lidas localmente: apenas os 30% inferiores da folha.
 if(!paginasSemTexto.length)return {total:null,motivo:'ausente'};
 informar('Reconhecendo o total no rodapé digitalizado...');
 const Tesseract=await carregarOcr();let worker=null;
 try{
  if(cancelado())throw new Error('Leitura cancelada.');
  worker=await Tesseract.createWorker('por',1,{
   workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js',
   corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0',
   langPath:'https://tessdata.projectnaptha.com/4.0.0',
  });
  await worker.setParameters({tessedit_pageseg_mode:'11',user_defined_dpi:'200'});
  for(const page of paginasSemTexto){
   if(cancelado())throw new Error('Leitura cancelada.');
   const original=page.getViewport({scale:1}),scale=Math.min(3,2000/original.width),viewport=page.getViewport({scale});
   const topo=Math.floor(viewport.height*.70),canvas=document.createElement('canvas');
   canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height-topo);
   await page.render({canvas,canvasContext:canvas.getContext('2d'),viewport,transform:[1,0,0,1,0,-topo],background:'#ffffff'}).promise;
   const {data}=await worker.recognize(canvas.toDataURL('image/png'),{}, {text:true,tsv:true});canvas.width=canvas.height=0;
   const resultado=identificarTotalColetas(data.text);
   if(resultado.ambiguo)return {total:null,motivo:'ambiguo'};
   if(resultado.total!==null){
    const palavras=String(data.tsv||'').split('\n').slice(1).map(linha=>linha.split('\t')).filter(cols=>cols.length>=12&&cols[11].trim());
    const numeros=palavras.filter(cols=>/^\d[\d.]*$/.test(cols[11].trim())&&Number(cols[11].trim().replace(/\./g,''))===resultado.total);
    if(numeros.some(cols=>Number(cols[10])>=65))return {total:resultado.total,origem:'ocr'};
    return {total:null,motivo:'ilegivel'};
   }
  }
  return candidatoTexto||{total:null,motivo:'ausente'};
 }finally{if(worker)await worker.terminate();}
}
