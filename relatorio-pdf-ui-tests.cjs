const {chromium}=require('playwright'),fs=require('fs'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const routes=[1,2,3].map(id=>({id,motorista:'Motorista '+id,placa:'ABC1D2'+id,regiao:'Lapa',status:'em_rota',numero_coletas:5}));
const stub=(perfil,ativo=true)=>'window.__state='+JSON.stringify({routes,user:{id:'test',nome:'Pessoa '+perfil,perfil,ativo,rotas_coleta_ids:perfil==='operador_coleta'?[1,2]:[]},users:[{id:'test',nome:'João',perfil:'admin',ativo:true,rotas_coleta_ids:[]},{id:'coleta',nome:'Ana',perfil:'operador_coleta',ativo:true,rotas_coleta_ids:[1,2]}],signedIn:perfil!=='anon'})+`;
window.supabase={createClient(){
 function query(table){let single=false,filter=null,patch=null;const q=new Proxy({}, {get(_,key){
  if(key==='then')return resolve=>{
   let data=table==='relatorio_documentos'?[window.__state.documento].filter(Boolean):table==='rotas'?window.__state.routes:table==='usuarios'?(filter?filter==='test'?[window.__state.user]:window.__state.users.filter(u=>u.id===filter):window.__state.users):[];
   if(patch){data.forEach(u=>Object.assign(u,patch));window.__lastUpdate={filter,patch};}
   resolve({data:single?data[0]||null:data,error:null});
  };
  if(key==='single'||key==='maybeSingle')return ()=>{single=true;return q};
  if(key==='eq')return (name,value)=>{if(name==='id')filter=value;return q};
  if(key==='upsert')return value=>{window.__state.documento=value;return q};if(key==='update')return value=>{patch=value;return q};return ()=>q;
 }});return q;}
 return {auth:{getSession:async()=>({data:{session:window.__state.signedIn?{user:{id:'test'},access_token:'test-jwt'}:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>{window.__state.signedIn=false;return {error:null}}},from:query,storage:{from(){return {async upload(path,file){window.__uploads=(window.__uploads||0)+1;window.__pdfFile=file;return {error:null}},async download(){return {data:window.__pdfFile||new Blob(['%PDF-1.4'],{type:'application/pdf'}),error:null}},async remove(){return {error:null}}}}},rpc:async()=>({data:0,error:null}),removeChannel:async()=>{},channel(){const c={on(){return c},subscribe(){return c},presenceState(){return {}},track:async()=>{}};return c;}};
}};`;

function pdfFixture() {
 const stream='BT /F1 24 Tf 55 730 Td (Relatorio de Coletas) Tj 0 -36 Td /F1 12 Tf (PDF de teste de visualizacao.) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>','<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>'];
 let result='%PDF-1.4\n',positions=[0];objects.forEach((body,i)=>{positions.push(result.length);result+=(i+1)+' 0 obj\n'+body+'\nendobj\n'});
 const xref=result.length;result+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n';positions.slice(1).forEach(at=>result+=String(at).padStart(10,'0')+' 00000 n \n');result+='trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';
 return Buffer.from(result);
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
   if(url==='https://consulta.test/relatorio-pdf-viewer.html')return route.fulfill({contentType:'text/html',body:fs.readFileSync(__dirname+'/relatorio-pdf-viewer.html','utf8')});
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
   assert.deepEqual(boxes.map(x=>x.text),['Bairros','Nova rota','Suporte','Sugestões','Histórico','Usuários']);
   for(const at of [0,2,4]){assert.equal(boxes[at].y,boxes[at+1].y);assert(boxes[at].x<boxes[at+1].x);}
   await page.locator('#gerenciamentoAtalhos button[aria-controls="adminUsuariosFerramenta"]').click();await page.waitForTimeout(1900);
   for(const target of ['adminBairrosFerramenta','adminNovaRotaFerramenta']){
    await page.locator('#gerenciamentoAtalhos button[aria-controls="'+target+'"]').click();await page.waitForTimeout(1900);
    assert.equal(await page.locator('#gerenciamentoView').evaluate(el=>el.scrollTop),0);
    if(target==='adminBairrosFerramenta'){await page.locator('#gerenciamentoAtalhos button[aria-controls="adminUsuariosFerramenta"]').click();await page.waitForTimeout(1900);}
   }
  }
  const allowed=perfil!=='operador_conferencia';
  const opened=await page.evaluate(()=>abrirRelatorio());assert.equal(opened,allowed);
  if(allowed){
   await page.locator('#relatorioArquivoPdf').setInputFiles({name:'invalido.pdf',mimeType:'application/pdf',buffer:Buffer.from('texto comum')});
   await page.waitForFunction(()=>!document.getElementById('relatorioEnviarPdf').disabled);
   assert.equal(await page.evaluate(()=>window.__uploads||0),0);
   await page.locator('#relatorioArquivoPdf').setInputFiles({name:'Relatorio.pdf',mimeType:'application/pdf',buffer:pdfFixture()});
   await page.waitForSelector('#relatorioPdfViewer');await page.waitForFunction(()=>document.getElementById('relatorioPdfViewer').contentDocument?.body?.dataset.pronto==='true');
   assert((await page.frameLocator('#relatorioPdfViewer').locator('canvas').count())>=1);
   assert.equal(await page.frameLocator('#relatorioPdfViewer').locator('.pagina').count(),2);
   assert(await page.frameLocator('#relatorioPdfViewer').locator('#paginas').evaluate(el=>el.scrollHeight>el.clientHeight));
   assert.equal(await page.locator('#relatorioPdfStatus').innerText(),'Relatorio.pdf');
   assert.equal(await page.evaluate(()=>window.__uploads),1);
   const bounds=await page.evaluate(()=>{const box=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom}};return {pdf:box(document.getElementById('relatorioPdfViewer')),header:box(document.querySelector('.relatorio-cabecalho')),pane:box(document.getElementById('relatorioView')),menu:box(document.querySelector('.sidebar')),width:innerWidth,scroll:document.documentElement.scrollWidth}});
   assert(bounds.pdf.y>=bounds.header.bottom);assert(bounds.pdf.bottom<=bounds.pane.bottom);assert(bounds.pdf.right<=bounds.pane.right);assert(bounds.scroll<=bounds.width);
   assert(bounds.pdf.bottom-bounds.pdf.y>450);assert(bounds.pdf.right-bounds.pdf.x>=bounds.pane.right-bounds.pane.x-100,JSON.stringify(bounds));assert(bounds.pane.bottom-bounds.pdf.bottom<40);
   if(width===390)assert(bounds.pdf.y>=bounds.menu.bottom);else assert(bounds.pdf.x>=bounds.menu.right);
   await page.evaluate(()=>{renderizarRelatorio();window.__printed=false;document.getElementById('relatorioPdfViewer').contentWindow.print=()=>window.__printed=true;});
   await page.locator('.relatorio-imprimir').click();await page.waitForFunction(()=>window.__printed);
   assert.equal(await page.frameLocator('#relatorioPdfViewer').locator('canvas').count(),2);
   await page.evaluate(()=>{relatorioPdfUrl=null;document.getElementById('relatorioConteudo').replaceChildren();return carregarPdfRelatorio();});
   assert.equal(await page.locator('#relatorioPdfViewer').count(),1);
   await page.waitForFunction(()=>document.getElementById('relatorioPdfViewer').contentDocument?.body?.dataset.pronto==='true');
   if(perfil==='admin'){await page.waitForTimeout(1200);await page.screenshot({path:__dirname+'/relatorio-pdf-'+width+'.png'});}
   await page.evaluate(()=>{window.__state.user.perfil='operador_conferencia';return atualizarInterfaceSessao();});
   assert.equal(await page.locator('#relatorioView').isVisible(),false);
   assert.equal(await page.locator('#relatorioPdfViewer').count(),0);
  }
  assert.deepEqual(errors,[]);results.push({width,perfil,ok:true});await ctx.close();
 }
 console.log(JSON.stringify(results));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
