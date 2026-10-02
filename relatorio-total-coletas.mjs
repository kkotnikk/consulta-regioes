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

export function textoRodape(items,viewport,transformar,inicio=.70) {
 const palavras=items.filter(item=>item.str?.trim()&&item.transform).map(item=>{
  const pos=transformar(viewport.transform,item.transform);
  return {texto:item.str,x:pos[4],y:pos[5]};
 }).filter(item=>item.y>=viewport.height*inicio&&item.y<=viewport.height+2);
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
 if(cancelado())throw new Error('Leitura cancelada.');
 // O total do relatório fica na última folha; números das demais não são usados.
 const page=await documento.getPage(documento.numPages),original=page.getViewport({scale:1});
 const {items}=await page.getTextContent();
 const resultadoTexto=identificarTotalColetas(textoRodape(items,original,pdfjs.Util.transform));
 if(resultadoTexto.ambiguo)return {total:null,motivo:'ambiguo'};
 if(resultadoTexto.total!==null)return {total:resultadoTexto.total,origem:'texto'};
 // Em relatórios curtos, o rodapé do conteúdo pode ficar acima do rodapé físico da folha.
 const resultadoConteudo=identificarTotalColetas(textoRodape(items,original,pdfjs.Util.transform,0));
 if(resultadoConteudo.total!==null)return {total:resultadoConteudo.total,origem:'texto'};
 informar('Reconhecendo o rodapé da última página...');
 const Tesseract=await carregarOcr();let worker=null;
 let canvas=null,recorte=null,recorteAmplo=null;
 try{
  if(cancelado())throw new Error('Leitura cancelada.');
  worker=await Tesseract.createWorker('por',1,{
   workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js',
   corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0',
   langPath:'https://tessdata.projectnaptha.com/4.0.0',
  });
  const scale=Math.min(3,2400/original.width,3600/original.height),viewport=page.getViewport({scale});
  canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  await page.render({canvas,canvasContext:canvas.getContext('2d'),viewport,background:'#ffffff'}).promise;
  const topo=Math.floor(canvas.height*.70);
  recorte=document.createElement('canvas');recorte.width=canvas.width;recorte.height=canvas.height-topo;
  const contexto=recorte.getContext('2d',{willReadFrequently:true});
  contexto.drawImage(canvas,0,topo,canvas.width,recorte.height,0,0,recorte.width,recorte.height);
  const topoAmplo=Math.floor(canvas.height*.40);
  recorteAmplo=document.createElement('canvas');recorteAmplo.width=canvas.width;recorteAmplo.height=canvas.height-topoAmplo;
  recorteAmplo.getContext('2d').drawImage(canvas,0,topoAmplo,canvas.width,recorteAmplo.height,0,0,recorteAmplo.width,recorteAmplo.height);
  canvas.width=canvas.height=0;
  for(const [modo,imagem] of [['6',recorte],['11',recorteAmplo]]){
   if(cancelado())throw new Error('Leitura cancelada.');
   await worker.setParameters({tessedit_pageseg_mode:modo,user_defined_dpi:'240'});
   const {data}=await worker.recognize(imagem,{}, {text:true,tsv:true});
   const resultado=identificarTotalColetas(data.text);
   if(resultado.ambiguo)return {total:null,motivo:'ambiguo'};
   if(resultado.total!==null){
    const palavras=String(data.tsv||'').split('\n').slice(1).map(linha=>linha.split('\t')).filter(cols=>cols.length>=12&&cols[11].trim());
    const numeros=palavras.filter(cols=>/^\d[\d.]*$/.test(cols[11].trim())&&Number(cols[11].trim().replace(/\./g,''))===resultado.total);
    if(numeros.some(cols=>Number(cols[10])>=80))return {total:resultado.total,origem:'ocr'};
    if(modo==='11')return {total:null,motivo:'ilegivel'};
   }
  }
  return {total:null,motivo:resultadoConteudo.ambiguo?'ambiguo':'ausente'};
 }finally{if(canvas)canvas.width=canvas.height=0;if(recorte)recorte.width=recorte.height=0;if(recorteAmplo)recorteAmplo.width=recorteAmplo.height=0;if(worker)await worker.terminate();}
}
