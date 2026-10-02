const {chromium}=require('playwright'),fs=require('fs'),assert=require('node:assert/strict');
const {stub,pdfFixture,soltarPdf}=require('./relatorio-pdf-ui-tests.cjs');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
function construirPdf(objects){
 const partes=[Buffer.from('%PDF-1.4\n')],offsets=[0];let size=partes[0].length;
 objects.forEach((body,i)=>{offsets.push(size);const part=Buffer.concat([Buffer.from((i+1)+' 0 obj\n'),Buffer.isBuffer(body)?body:Buffer.from(body),Buffer.from('\nendobj\n')]);partes.push(part);size+=part.length});
 let trailer='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n';offsets.slice(1).forEach(n=>trailer+=String(n).padStart(10,'0')+' 00000 n \n');
 trailer+='trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+size+'\n%%EOF';return Buffer.concat([...partes,Buffer.from(trailer)]);
}
function pdfTotal(total){
 const footer=total===null?'Pagina 1 de 1':'TOTAL: '+total+' COLETAS -';
 const stream='BT /F1 14 Tf 40 780 Td (Relatorio de coletas) Tj 0 -80 Td (TOTAL: 999 COLETAS - corpo ignorado) Tj 0 -655 Td ('+footer+') Tj ET';
 return construirPdf(['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>','<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>']);
}
async function pdfDigitalizado(page){
 if(process.env.PDF_TOTAL_SCANNED_PATH)return fs.readFileSync(process.env.PDF_TOTAL_SCANNED_PATH);
 const base64=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=800;canvas.height=100;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,800,100);ctx.fillStyle='black';ctx.font='bold 32px Arial';ctx.fillText('TOTAL:   24 COLETAS -',20,60);return canvas.toDataURL('image/jpeg').split(',')[1]});
 const jpg=Buffer.from(base64,'base64'),stream='BT /F1 12 Tf 40 750 Td (Relatorio com texto selecionavel) Tj 0 -715 Td (Pagina 1) Tj ET q 500 0 0 62.5 30 30 cm /Im0 Do Q';
 return construirPdf(['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 5 0 R >> /Font << /F1 6 0 R >> >> /Contents 4 0 R >>','<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream',Buffer.concat([Buffer.from('<< /Type /XObject /Subtype /Image /Width 800 /Height 100 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+jpg.length+' >>\nstream\n'),jpg,Buffer.from('\nendstream')]),'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']);
}
const ready=page=>page.waitForFunction(()=>{const b=document.getElementById('relatorioPdfViewer')?.contentDocument?.body;return b?.dataset.pronto==='true'&&b.dataset.totalConcluido==='true'});
(async()=>{
 const {identificarTotalColetas,textoRodape}=await import('./relatorio-total-coletas.mjs');
 for(const [texto,total] of [['TOTAL: 24 COLETAS -',24],['TOTAL DE COLETAS: 9',9],['TOTAL GERAL: 12.500 COLETAS',12500],['TOTAL:\n0\nCOLETAS',0],['SUBTOTAL: 8 COLETAS',null],['TOTAL PARCIAL: 7 COLETAS',null],['TOTAL: 24,5 COLETAS',null],['TOTAL: 99999999 COLETAS',null],['Endereço 24 e Pedido 42',null]])assert.equal(identificarTotalColetas(texto).total,total,texto);
 assert.equal(identificarTotalColetas('TOTAL: 24 COLETAS TOTAL: 30 COLETAS').ambiguo,true);
 const rodape=textoRodape([{str:'TOTAL: 999 COLETAS',transform:[1,0,0,1,0,700]},{str:'COLETAS',transform:[1,0,0,1,140,40]},{str:'24',transform:[1,0,0,1,100,40]},{str:'TOTAL:',transform:[1,0,0,1,30,40]}],{height:842,transform:[]},(_,b)=>[1,0,0,1,b[4],842-b[5]]);
 assert.equal(identificarTotalColetas(rodape).total,24);
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader'],env:{...process.env,LD_LIBRARY_PATH:process.env.CHROMIUM_LIBRARY_PATH||process.env.LD_LIBRARY_PATH||''}}),results=[];
 for(const width of [1280,390])for(const perfil of ['admin','operador_coleta']){
  const ctx=await browser.newContext({viewport:{width,height:900}});
  await ctx.addInitScript(()=>sessionStorage.setItem('solidez_soft_intro_v1','1'));
  await ctx.route('**/*',route=>{
   const url=route.request().url();
   if(url==='https://consulta.test/')return route.fulfill({contentType:'text/html',body:html});
   if(url.startsWith('https://consulta.test/relatorio-pdf-viewer.html?v='))return route.fulfill({contentType:'text/html',body:fs.readFileSync(__dirname+'/relatorio-pdf-viewer.html','utf8')});
   if(url.startsWith('https://consulta.test/relatorio-total-coletas.mjs'))return route.fulfill({contentType:'application/javascript',body:fs.readFileSync(__dirname+'/relatorio-total-coletas.mjs','utf8')});
   if(url.endsWith('/build/pdf.min.mjs'))return route.fulfill({contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:fs.readFileSync(process.env.PDFJS_MODULE_PATH||'/tmp/consulta-pdf.min.mjs','utf8')});
   if(url.endsWith('/build/pdf.worker.min.mjs'))return route.fulfill({contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:fs.readFileSync(process.env.PDFJS_WORKER_PATH||'/tmp/consulta-pdf.worker.min.mjs','utf8')});
   if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:stub(perfil)});
   if(url.includes('tesseract')||url.includes('tessdata')){const name=url.split('/').pop(),local=(process.env.OCR_ASSET_DIR||'/tmp/consulta-ocr')+'/'+name;if(fs.existsSync(local))return route.fulfill({contentType:name.endsWith('.gz')?'application/gzip':'application/javascript',headers:{'access-control-allow-origin':'*'},body:fs.readFileSync(local)});console.error('Recurso OCR ausente:',url);}
   return route.abort();
  });
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://consulta.test/');await page.evaluate(()=>atualizarInterfaceSessao());
  if(perfil==='admin')await page.evaluate(()=>mostrarPainelAdmin());
  await page.evaluate(()=>abrirRelatorio());
  async function enviar(total,name='Diario.pdf',buffer=pdfTotal(total)){
   await page.locator('#relatorioArquivoPdf').setInputFiles({name,mimeType:'application/pdf',buffer});
   await page.waitForFunction(name=>!relatorioPdfEnviando&&relatorioDocumentoAtual?.nome===name,name);await ready(page);
  }
  await enviar(24);
  assert.match(await page.locator('#relatorioTotalTexto').innerText(),/24 coletas.*atualizado/);
  assert.equal(await page.evaluate(()=>rotasPublicasCache.find(r=>r.id===1).numero_coletas),24);
  if(perfil==='admin')assert.equal(await page.evaluate(()=>rotasAdminCache.find(r=>r.id===1).numero_coletas),24);
  if(perfil==='admin'){
   await page.evaluate(()=>editarRota(1));await page.locator('#editarNumeroColetas').fill('31');
   await page.evaluate(()=>salvarEdicaoRota());
   assert.equal(await page.evaluate(()=>window.__state.routes[0].numero_coletas),31);
   await page.evaluate(()=>document.getElementById('relatorioPdfViewer').contentWindow.lerTotalPdf());
   await page.waitForFunction(()=>document.getElementById('relatorioPdfViewer').contentDocument.body.dataset.totalConcluido==='true');
   assert.equal(await page.evaluate(()=>window.__state.routes[0].numero_coletas),31);
   assert.match(await page.locator('#relatorioTotalTexto').innerText(),/ajustado manualmente/);
   await page.evaluate(()=>window.__routeUpdateEmpty=true);
   await page.evaluate(()=>editarRota(1));await page.locator('#editarNumeroColetas').fill('32');
   await page.evaluate(()=>salvarEdicaoRota());
   assert.equal(await page.evaluate(()=>window.__state.routes[0].numero_coletas),31);
   assert.equal(await page.locator('#modalEditarRota').getAttribute('aria-hidden'),'false');
   assert.match(await page.locator('.toast').last().innerText(),/não foi salvo/);
   await page.evaluate(()=>{window.__routeUpdateEmpty=false;fecharEdicaoRota()});
  }
  await page.evaluate(()=>renderizarRotasPublicas());
  assert.match(await page.locator('#rotasPublicas').innerText(),/24/);
  await enviar(null,'Sem-total.pdf');
  assert.match(await page.locator('#relatorioTotalTexto').innerText(),/não identificado/);
  assert.equal(await page.evaluate(()=>window.__state.routes[0].numero_coletas),24);
  assert.equal(await page.locator('#relatorioRelerTotal').isVisible(),true);
  await enviar(0,'Zero.pdf');assert.equal(await page.evaluate(()=>window.__state.routes[0].numero_coletas),0);
  await page.locator('#relatorioPagina2').click();await page.waitForFunction(()=>!relatorioPdfCarregando);
  await enviar(9,'Rota2.pdf');
  assert.equal(await page.evaluate(()=>window.__state.routes[1].numero_coletas),9);
  assert.equal(await page.evaluate(()=>window.__state.routes[0].numero_coletas),0);
  await page.locator('#relatorioPagina1').click();await ready(page);
  await enviar(24,'Digitalizado.pdf',await pdfDigitalizado(page));
  assert.match(await page.locator('#relatorioTotalTexto').innerText(),/24 coletas.*atualizado/);
  assert.equal(await page.evaluate(()=>window.__state.routes[0].numero_coletas),24);
  assert.equal(await page.evaluate(()=>window.__totalStarted.p_origem),'ocr');
  // A failed server update keeps the previous card value and offers a retry.
  await page.evaluate(()=>window.__totalFailure=true);await enviar(42,'Novo-total.pdf');
  assert.match(await page.locator('#relatorioTotalTexto').innerText(),/Não foi possível atualizar/);
  assert.equal(await page.evaluate(()=>window.__state.routes[0].numero_coletas),24);
  await page.evaluate(()=>window.__totalFailure=false);await page.locator('#relatorioRelerTotal').click();
  await page.waitForFunction(()=>window.__state.routes[0].numero_coletas===42);
  // A delayed read of an older file cannot apply after replacement or to another route.
  await page.evaluate(()=>{window.__totalDelay=350;window.__totalStarted=null});
  await enviar(24,'Anterior.pdf');
  await page.evaluate(()=>{window.__totalStarted=null;document.getElementById('relatorioPdfViewer').contentWindow.lerTotalPdf()});
  await page.waitForFunction(()=>window.__totalStarted);
  await page.locator('#relatorioPagina2').click();await ready(page);
  assert.equal(await page.evaluate(()=>window.__state.routes[1].numero_coletas),9);
  await page.evaluate(()=>window.__totalDelay=0);await page.locator('#relatorioPagina1').click();await ready(page);
  if(perfil==='admin'){
   await page.evaluate(base64=>{const state=window.__state,path='coleta/1/novo.pdf';state.files[path]=new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],{type:'application/pdf'});state.documents['coleta|1']={usuario_id:'coleta',rota_id:1,arquivo_path:path,nome:'Ana.pdf',atualizado_em:new Date(Date.now()+5000).toISOString()}},pdfTotal(42).toString('base64'));
   await page.locator('#relatorioUsuarios').click();
   await page.waitForFunction(()=>!relatorioAdminCarregando&&relatorioDocumentoAtual?.usuario_id==='coleta');await ready(page);
   assert.equal(await page.evaluate(()=>window.__state.routes[0].numero_coletas),42);
   await page.locator('#relatorioMeus').click();await ready(page);
   assert.match(await page.locator('#relatorioTotalTexto').innerText(),/PDF mais recente/);
   assert.equal(await page.evaluate(()=>rotasPublicasCache.find(r=>r.id===1).numero_coletas),42);
  }
  await page.waitForTimeout(900);await page.screenshot({path:'/tmp/consulta-total-'+perfil+'-'+width+'.png'});
  assert.deepEqual(errors,[]);results.push({width,perfil,footer24:true,ignoreBody:true,zero:true,realOcr:true,routeIsolation:true,retry:true});await ctx.close();
 }
 console.log(JSON.stringify(results));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
