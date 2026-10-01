const {chromium}=require('playwright'),fs=require('fs'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const routes=[1,2,3].map(id=>({id,motorista:'Motorista '+id,placa:'ABC1D2'+id,regiao:'Lapa',status:'em_rota',numero_coletas:5}));
const stub=(perfil,ativo=true)=>'window.__state='+JSON.stringify({routes,documents:{},files:{},user:{id:'test',nome:'Pessoa '+perfil,perfil,ativo,rotas_coleta_ids:['admin','operador_coleta'].includes(perfil)?[1,2,3]:[]},users:[{id:'test',nome:'João',perfil:'admin',ativo:true,rotas_coleta_ids:[1,2,3]},{id:'coleta',nome:'Ana',perfil:'operador_coleta',ativo:true,rotas_coleta_ids:[1,2,3]}],signedIn:perfil!=='anon'})+`;
window.supabase={createClient(){
 function query(table){let single=false,filters={},patch=null;const q=new Proxy({}, {get(_,key){
  if(key==='then')return resolve=>{
   let data=table==='relatorios_por_rota'?Object.values(window.__state.documents):table==='rotas'?window.__state.routes:table==='usuarios'?filters.id===window.__state.user.id?[window.__state.user]:window.__state.users:[];
   if(table!=='usuarios')data=data.filter(row=>Object.entries(filters).every(([key,value])=>row[key]===value));
   else if(filters.id)data=data.filter(u=>u.id===filters.id);
   if(patch){data.forEach(u=>Object.assign(u,patch));window.__lastUpdate={filters,patch};}
   resolve({data:single?data[0]||null:data,error:null});
  };
  if(key==='single'||key==='maybeSingle')return ()=>{single=true;return q};
  if(key==='eq')return (name,value)=>{filters[name]=value;return q};
  if(key==='upsert')return value=>{window.__state.documents[value.usuario_id+'|'+value.rota_id]=value;return q};if(key==='update')return value=>{patch=value;return q};return ()=>q;
 }});return q;}
 return {auth:{getSession:async()=>({data:{session:window.__state.signedIn?{user:{id:window.__state.user.id},access_token:'test-jwt'}:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>{window.__state.signedIn=false;return {error:null}}},from:query,storage:{from(){return {async upload(path,file){window.__uploads=(window.__uploads||0)+1;window.__state.files[path]=file;return {error:null}},async download(path){window.__downloadStarted=path;if(window.__downloadDelay)await new Promise(r=>setTimeout(r,window.__downloadDelay));return {data:window.__state.files[path],error:null}},async remove(paths){window.__removed=paths;paths.forEach(p=>delete window.__state.files[p]);return {error:null}}}}},rpc:async()=>({data:0,error:null}),removeChannel:async()=>{},channel(){const c={on(){return c},subscribe(){return c},presenceState(){return {}},track:async()=>{}};return c;}};
}};`;

function pdfFixture() {
 const stream='BT /F1 24 Tf 55 730 Td (Relatorio de Coletas) Tj 0 -36 Td /F1 12 Tf (PDF de teste de visualizacao.) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>','<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>'];
 let result='%PDF-1.4\n',positions=[0];objects.forEach((body,i)=>{positions.push(result.length);result+=(i+1)+' 0 obj\n'+body+'\nendobj\n'});
 const xref=result.length;result+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n';positions.slice(1).forEach(at=>result+=String(at).padStart(10,'0')+' 00000 n \n');result+='trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';
 return Buffer.from(result);
}
async function soltarPdf(locator,files){
 await locator.evaluate((el,files)=>{
  const transfer=new DataTransfer();
  for(const file of files)transfer.items.add(new File([Uint8Array.from(atob(file.base64),c=>c.charCodeAt(0))],file.name,{type:'application/pdf'}));
  for(const type of ['dragenter','dragover','drop'])el.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:transfer}));
 },files.map(f=>({name:f.name,base64:f.buffer.toString('base64')})));
}
(async()=>{
 const launch={executablePath:process.env.CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader'],env:{...process.env,LD_LIBRARY_PATH:process.env.CHROMIUM_LIBRARY_PATH||process.env.LD_LIBRARY_PATH||''}};
 const browser=await chromium.launch(launch),results=[];
 for(const width of [1280,390])for(const perfil of ['admin','operador_coleta','operador_conferencia']){
  const ctx=await browser.newContext({viewport:{width,height:900}});
  await ctx.addInitScript(()=>sessionStorage.setItem('solidez_soft_intro_v1','1'));
  await ctx.route('**/*',route=>{
   const url=route.request().url();
   if(url==='https://consulta.test/')return route.fulfill({contentType:'text/html',body:html});
   if(url.startsWith('https://consulta.test/relatorio-pdf-viewer.html?v='))return route.fulfill({contentType:'text/html',body:fs.readFileSync(__dirname+'/relatorio-pdf-viewer.html','utf8')});
   if(url.endsWith('/build/pdf.min.mjs'))return route.fulfill({contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:fs.readFileSync(process.env.PDFJS_MODULE_PATH||'/tmp/consulta-pdf.min.mjs','utf8')});
   if(url.endsWith('/build/pdf.worker.min.mjs'))return route.fulfill({contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:fs.readFileSync(process.env.PDFJS_WORKER_PATH||'/tmp/consulta-pdf.worker.min.mjs','utf8')});
   if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:stub(perfil)});
   return route.abort();
  });
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://consulta.test/');await page.evaluate(()=>atualizarInterfaceSessao());
  if(perfil==='admin'){
   await page.evaluate(()=>{window.__opening=mostrarPainelAdmin()});
   await page.waitForTimeout(180);
   const opening=await page.locator('#gerenciamentoAtalhos').evaluate(el=>({animations:el.getAnimations().map(a=>a.animationName),height:el.getBoundingClientRect().height,opacity:getComputedStyle(el).opacity}));
   assert(opening.animations.includes('admin-atalhos-descer'),JSON.stringify(opening));
   await page.evaluate(()=>window.__opening);
   const boxes=await page.locator('#gerenciamentoAtalhos button').evaluateAll(els=>els.map(el=>({text:el.textContent.trim(),x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y})));
   assert.deepEqual(boxes.map(x=>x.text),['Bairros e rotas','Suporte e sugestões','Histórico e usuários']);
   assert.equal(boxes.length,3);assert(boxes[0].y<boxes[1].y&&boxes[1].y<boxes[2].y);
   await page.locator('#gerenciamentoAtalhos button[aria-controls~="adminHistoricoFerramenta"]').click();await page.waitForTimeout(1900);
   for(const target of ['adminBairrosFerramenta']){
    await page.locator('#gerenciamentoAtalhos button[aria-controls~="'+target+'"]').click();await page.waitForTimeout(1900);
    assert.equal(await page.locator('#gerenciamentoView').evaluate(el=>el.scrollTop),0);
    if(target==='adminBairrosFerramenta'){await page.locator('#gerenciamentoAtalhos button[aria-controls~="adminHistoricoFerramenta"]').click();await page.waitForTimeout(1900);}
   }
  }
  const allowed=perfil!=='operador_conferencia';
  const opened=await page.evaluate(()=>abrirRelatorio());assert.equal(opened,allowed);
  if(allowed){
   await page.locator('#relatorioArquivoPdf').setInputFiles({name:'invalido.pdf',mimeType:'application/pdf',buffer:Buffer.from('texto comum')});
   await page.waitForFunction(()=>!document.getElementById('relatorioEnviarPdf').disabled);
   assert.equal(await page.evaluate(()=>window.__uploads||0),0);
   const center=await page.evaluate(()=>{const a=document.getElementById('relatorioConteudo').getBoundingClientRect(),b=document.getElementById('relatorioSoltarPdf').getBoundingClientRect();return {dx:Math.abs((a.left+a.right-b.left-b.right)/2),dy:Math.abs((a.top+a.bottom-b.top-b.bottom)/2),border:getComputedStyle(document.getElementById('relatorioSoltarPdf')).borderStyle}});
   assert(center.dx<2&&center.dy<2,JSON.stringify(center));assert.equal(center.border,'dashed');
   if(perfil==='admin')await page.screenshot({path:__dirname+'/relatorio-soltar-pdf-'+width+'.png'});
   await soltarPdf(page.locator('#relatorioConteudo'),[{name:'um.pdf',buffer:pdfFixture()},{name:'dois.pdf',buffer:pdfFixture()}]);
   assert.equal(await page.evaluate(()=>window.__uploads||0),0);

   const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator('#relatorioSoltarPdf').click()]);
   await chooser.setFiles({name:'Relatorio.pdf',mimeType:'application/pdf',buffer:pdfFixture()});
   await page.waitForSelector('#relatorioPdfViewer');await page.waitForFunction(()=>document.getElementById('relatorioPdfViewer').contentDocument?.body?.dataset.pronto==='true');
   assert((await page.frameLocator('#relatorioPdfViewer').locator('canvas').count())>=1);
   assert.equal(await page.frameLocator('#relatorioPdfViewer').locator('.pagina').count(),2);
   const row=await page.frameLocator('#relatorioPdfViewer').locator('.pagina').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right}}));
   assert.equal(row[0].y,row[1].y);assert(row[1].x>row[0].right);
   const viewer=page.frameLocator('#relatorioPdfViewer');
   const initial=await viewer.locator('.pagina').first().boundingBox();
   const zoomed=await viewer.locator('#paginas').evaluate(el=>{const event=new WheelEvent('wheel',{ctrlKey:true,deltaY:-120,bubbles:true,cancelable:true,clientX:el.getBoundingClientRect().left+100,clientY:el.getBoundingClientRect().top+100});el.dispatchEvent(event);return {prevented:event.defaultPrevented,zoom:Number(document.body.dataset.zoom)};});
   assert(zoomed.prevented&&zoomed.zoom>1);assert((await viewer.locator('.pagina').first().boundingBox()).width>initial.width);
   await viewer.locator('#zoomAjustar').click();
   assert.equal(await viewer.locator('body').getAttribute('data-zoom'),'1');
   await viewer.locator('#zoomMais').click();assert.equal(await viewer.locator('#zoomValor').innerText(),'120%');
   await viewer.locator('#zoomMenos').click();assert.equal(await viewer.locator('#zoomValor').innerText(),'100%');
   const ordinary=await viewer.locator('#paginas').evaluate(el=>{const event=new WheelEvent('wheel',{deltaY:120,cancelable:true});el.dispatchEvent(event);return {prevented:event.defaultPrevented,zoom:Number(document.body.dataset.zoom)};});
   assert.equal(ordinary.prevented,false);assert.equal(ordinary.zoom,1);
   const sheet=await page.frameLocator('#relatorioPdfViewer').locator('.pagina').first().evaluate(el=>{const b=el.getBoundingClientRect(),root=document.getElementById('paginas'),area=root.getBoundingClientRect();return {width:b.width,height:b.height,top:b.top-area.top,bottom:b.bottom-area.top,viewportHeight:root.clientHeight,viewportWidth:root.clientWidth};});
   assert(sheet.top>=0&&sheet.bottom<=sheet.viewportHeight,JSON.stringify(sheet));
   assert(sheet.width<=sheet.viewportWidth&&Math.abs(sheet.width/sheet.height-595/842)<.01);
   if(perfil==='admin'){
    await page.setViewportSize({width,height:700});
    await page.waitForFunction(()=>{const doc=document.getElementById('relatorioPdfViewer').contentDocument,root=doc.getElementById('paginas');return doc.querySelector('.pagina').getBoundingClientRect().bottom-root.getBoundingClientRect().top<=root.clientHeight;});
    const smaller=await page.frameLocator('#relatorioPdfViewer').locator('.pagina').first().boundingBox();
    assert(smaller.height<sheet.height);
    await page.setViewportSize({width,height:900});
    await page.waitForFunction(original=>document.getElementById('relatorioPdfViewer').contentDocument.querySelector('.pagina').getBoundingClientRect().width>=original-1,sheet.width);
   }
   assert.equal(await page.locator('#relatorioPdfStatus').innerText(),'Relatorio.pdf');
   assert.equal(await page.evaluate(()=>window.__uploads),1);
   const bounds=await page.evaluate(()=>{const box=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom}};return {pdf:box(document.getElementById('relatorioPdfViewer')),header:box(document.querySelector('.relatorio-cabecalho')),pane:box(document.getElementById('relatorioView')),menu:box(document.querySelector('.sidebar')),width:innerWidth,scroll:document.documentElement.scrollWidth}});
   assert(bounds.pdf.y>=bounds.header.bottom);assert(bounds.pdf.bottom<=bounds.pane.bottom);assert(bounds.pdf.right<=bounds.pane.right);assert(bounds.scroll<=bounds.width);
   assert(bounds.pdf.bottom-bounds.pdf.y>350);assert(bounds.pdf.right-bounds.pdf.x>=bounds.pane.right-bounds.pane.x-100,JSON.stringify(bounds));assert(bounds.pane.bottom-bounds.pdf.bottom<40);
   if(width===390)assert(bounds.pdf.y>=bounds.menu.bottom);else assert(bounds.pdf.x>=bounds.menu.right);
   await page.evaluate(()=>{renderizarRelatorio();window.__printed=false;document.getElementById('relatorioPdfViewer').contentWindow.print=()=>window.__printed=true;});
   await page.locator('.relatorio-imprimir').click();await page.waitForFunction(()=>window.__printed);
   assert.equal(await page.frameLocator('#relatorioPdfViewer').locator('canvas').count(),2);
   await page.emulateMedia({media:'print'});
   const printLayout=await viewer.locator('.pagina').evaluateAll(els=>els.map(el=>({display:getComputedStyle(el.parentElement).display,after:getComputedStyle(el).breakAfter,top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom})));
   assert.equal(printLayout[0].display,'block');assert.equal(printLayout[0].after,'page');assert(printLayout[1].top>=printLayout[0].bottom);
   assert.equal(await viewer.locator('.ferramentas').isVisible(),false);
   await page.emulateMedia({media:'screen'});
   const originalPath=await page.evaluate(()=>relatorioDocumentoAtual.arquivo_path);
   for(const slot of [2,3]){
    await page.locator('#relatorioPagina'+slot).click();
    await page.waitForFunction(()=>!relatorioPdfCarregando);
    assert.equal(await page.locator('#relatorioPdfViewer').count(),0);
    if(slot===2)await soltarPdf(page.locator('#relatorioConteudo'),[{name:'Rota2.pdf',buffer:pdfFixture()}]);
    else await page.locator('#relatorioArquivoPdf').setInputFiles({name:'Rota'+slot+'.pdf',mimeType:'application/pdf',buffer:pdfFixture()});
    await page.waitForFunction(()=>!relatorioPdfEnviando);
    await page.waitForFunction(()=>document.getElementById('relatorioPdfViewer')?.contentDocument?.body?.dataset.pronto==='true');
    assert.equal(await page.locator('#relatorioPdfStatus').innerText(),'Rota'+slot+'.pdf');
    assert.equal(await page.evaluate(()=>relatorioDocumentoAtual.rota_id),slot);
   }
   assert.equal(await page.evaluate(()=>Object.keys(window.__state.documents).length),3);
   await page.locator('#relatorioPagina1').click();
   await page.waitForFunction(()=>document.getElementById('relatorioPdfViewer')?.contentDocument?.body?.dataset.pronto==='true');
   assert.equal(await page.locator('#relatorioPdfStatus').innerText(),'Relatorio.pdf');
   await soltarPdf(page.frameLocator('#relatorioPdfViewer').locator('#paginas'),[{name:'Rota1-atualizada.pdf',buffer:pdfFixture()}]);
   await page.waitForFunction(()=>!relatorioPdfEnviando);
   assert.equal(await page.evaluate(()=>Object.keys(window.__state.documents).length),3);
   assert(await page.evaluate(p=>window.__removed.includes(p),originalPath));
   await page.evaluate(()=>{window.__downloadDelay=250;window.__downloadStarted=null});
   await page.locator('#relatorioPagina2').click();
   await page.waitForFunction(()=>window.__downloadStarted);
   await page.locator('#relatorioPagina3').click();
   await page.waitForFunction(()=>document.getElementById('relatorioPdfViewer')?.contentDocument?.body?.dataset.pronto==='true');
   assert.equal(await page.locator('#relatorioPdfStatus').innerText(),'Rota3.pdf');
   await page.evaluate(()=>{window.__downloadDelay=0});
   if(perfil==='admin'){await page.waitForTimeout(1200);await page.screenshot({path:__dirname+'/relatorio-pdf-'+width+'.png'});}
   await page.evaluate(()=>{window.__state.user={...window.__state.user,id:'outra-pessoa',perfil:'operador_coleta'};return atualizarInterfaceSessao();});
   assert.equal(await page.locator('#relatorioPdfViewer').count(),0);
   await page.evaluate(()=>carregarPdfRelatorio());
   assert.equal(await page.locator('#relatorioPdfViewer').count(),0);
   await page.evaluate(()=>{window.__state.user.rotas_coleta_ids=[1];return atualizarInterfaceSessao();});
   assert.equal(await page.locator('#relatorioPagina2').isDisabled(),true);
   assert.equal(await page.locator('#relatorioPagina3').isDisabled(),true);
   await page.evaluate(()=>{window.__state.user.rotas_coleta_ids=[];return atualizarInterfaceSessao();});
   assert.equal(await page.locator('#relatorioEnviarPdf').isDisabled(),true);
   assert.equal(await page.locator('#relatorioSoltarPdf').isDisabled(),true);
   await page.evaluate(()=>{window.__state.user.perfil='operador_conferencia';return atualizarInterfaceSessao();});
   assert.equal(await page.locator('#relatorioView').isVisible(),false);
   assert.equal(await page.locator('#relatorioPdfViewer').count(),0);
  }
  assert.deepEqual(errors,[]);results.push({width,perfil,ok:true});await ctx.close();
 }
 console.log(JSON.stringify(results));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
