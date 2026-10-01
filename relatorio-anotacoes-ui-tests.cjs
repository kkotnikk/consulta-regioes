const {chromium}=require('playwright'),fs=require('fs'),assert=require('node:assert/strict');
const {stub,pdfFixture,soltarPdf}=require('./relatorio-pdf-ui-tests.cjs');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const ready=page=>page.waitForFunction(()=>{const b=document.getElementById('relatorioPdfViewer')?.contentDocument?.body;return b?.dataset.pronto==='true'&&b.dataset.anotacoesProntas==='true'});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader'],env:{...process.env,LD_LIBRARY_PATH:process.env.CHROMIUM_LIBRARY_PATH||process.env.LD_LIBRARY_PATH||''}}),results=[];
 for(const width of [1280,390])for(const perfil of ['admin','operador_coleta']){
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
  await page.evaluate(()=>abrirRelatorio());
  await page.locator('#relatorioArquivoPdf').setInputFiles({name:'Diario.pdf',mimeType:'application/pdf',buffer:pdfFixture()});await ready(page);
  const viewer=page.frameLocator('#relatorioPdfViewer');
  await viewer.locator('#notaConcluida').click();
  await viewer.locator('.pagina').first().click({position:{x:60,y:80}});
  await viewer.locator('.anotacao.concluida').waitFor();
  let notes=await page.evaluate(()=>Object.values(window.__state.annotations));
  assert.equal(notes.length,1);assert.equal(notes[0].usuario_id,'test');assert.equal(notes[0].rota_id,1);assert.equal(notes[0].pagina,1);assert.equal(notes[0].tipo,'concluida');
  await viewer.locator('#notaComentario').click();
  await viewer.locator('.pagina').nth(1).scrollIntoViewIfNeeded();
  await viewer.locator('.pagina').nth(1).click({position:{x:65,y:95}});
  await viewer.locator('#notaTexto').fill('Cliente atendido. <img src=x onerror=alert(1)>');
  await viewer.locator('#notaSalvar').click();await viewer.locator('.anotacao.comentario').waitFor();
  assert.equal(await viewer.locator('.anotacao.comentario img').count(),0);
  assert.match(await viewer.locator('.anotacao.comentario').innerText(),/<img/);
  await viewer.locator('.anotacao.comentario').click();
  await viewer.locator('#notaTexto').fill('Coleta realizada; portaria confirmou o recebimento.');
  await viewer.locator('#notaSalvar').click();
  await page.waitForFunction(()=>Object.values(window.__state.annotations).some(n=>n.comentario.startsWith('Coleta realizada;')));
  assert.equal((await page.evaluate(()=>Object.values(window.__state.annotations))).length,2);
  const noteBox=await viewer.locator('.anotacao.comentario').boundingBox();
  await viewer.locator('#zoomMais').click();
  assert((await viewer.locator('.anotacao.comentario').boundingBox()).width>noteBox.width);
  assert.equal(await viewer.locator('.anotacao').count(),2);
  await viewer.locator('#zoomAjustar').click();
  await viewer.locator('#notaNavegar').click();
  await viewer.locator('.pagina').first().scrollIntoViewIfNeeded();
  await viewer.locator('.anotacao.concluida').click();await viewer.locator('#notaRemover').click();
  await page.waitForFunction(()=>Object.values(window.__state.annotations).length===1);
  assert.equal(await viewer.locator('.anotacao.concluida').count(),0);
  await viewer.locator('#notaConcluida').click();await viewer.locator('.pagina').first().click({position:{x:55,y:75}});
  await viewer.locator('.anotacao.concluida').waitFor();
  // Reopening retrieves saved marks, while the other route stays independent.
  await page.locator('#relatorioPagina2').click();await page.waitForFunction(()=>!relatorioPdfCarregando);
  await page.locator('#relatorioArquivoPdf').setInputFiles({name:'Outra-rota.pdf',mimeType:'application/pdf',buffer:pdfFixture()});await ready(page);
  assert.equal(await viewer.locator('.anotacao').count(),0);
  await page.locator('#relatorioPagina1').click();await ready(page);
  assert.equal(await viewer.locator('.anotacao').count(),2);
  await page.evaluate(()=>{window.__printed=false;document.getElementById('relatorioPdfViewer').contentWindow.print=()=>window.__printed=true});
  await page.locator('.relatorio-imprimir').click();await page.waitForFunction(()=>window.__printed);
  assert.equal(await viewer.locator('.pagina canvas').count(),2);
  assert.equal(await viewer.locator('.anotacao').count(),2);
  await page.emulateMedia({media:'print'});
  assert.equal(await viewer.locator('.ferramentas-anotacoes').isVisible(),false);
  const printNotes=await viewer.locator('.anotacao').evaluateAll(els=>els.map(el=>{const b=el.getBoundingClientRect(),p=el.closest('.pagina').getBoundingClientRect();return {text:el.textContent,display:getComputedStyle(el).display,inside:b.left>=p.left-1&&b.top>=p.top-1&&b.right<=p.right+1&&b.bottom<=p.bottom+1}}));
  assert(printNotes.every(n=>n.inside&&n.display!=='none'),JSON.stringify(printNotes));
  assert(printNotes.some(n=>n.text.startsWith('Coleta realizada;')));
  await page.emulateMedia({media:'screen'});
  await page.waitForTimeout(900);
  await page.evaluate(()=>document.querySelectorAll('.toast').forEach(el=>el.remove()));
  await page.screenshot({path:'/tmp/consulta-anotacoes-'+perfil+'-'+width+'.png'});
  // Failed saves never show a mark as if it had been persisted.
  await page.evaluate(()=>window.__annotationSaveFailure=true);
  await viewer.locator('#notaConcluida').click();await viewer.locator('.pagina').first().click({position:{x:90,y:110}});
  await page.waitForFunction(()=>document.getElementById('relatorioPdfViewer').contentDocument.getElementById('notaEstado').classList.contains('erro'));
  assert.equal(await viewer.locator('.anotacao').count(),2);
  await page.evaluate(()=>window.__annotationSaveFailure=false);
  await viewer.locator('.pagina').first().click({position:{x:90,y:110}});await page.waitForFunction(()=>Object.values(window.__state.annotations).length===3);
  // Loading failures block editing and printing until the user retries.
  await page.evaluate(()=>window.__annotationFailure=true);
  await viewer.locator('#notaAtualizar').click();await page.waitForFunction(()=>document.getElementById('relatorioPdfViewer').contentDocument.getElementById('notaEstado').classList.contains('erro'));
  assert.equal(await viewer.locator('#notaConcluida').isDisabled(),true);
  await page.evaluate(()=>window.__printed=false);await page.locator('.relatorio-imprimir').click();
  await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.__printed),false);
  await page.evaluate(()=>window.__annotationFailure=false);await viewer.locator('#notaAtualizar').click();await ready(page);
  assert.equal(await viewer.locator('.anotacao').count(),3);
  if(perfil==='admin'){
   // Administrators see and can annotate another user's PDF, without mixing owners.
   await page.evaluate(()=>{const state=window.__state;const doc=state.documents['test|1'];const path='coleta/1/outro.pdf';state.files[path]=state.files[doc.arquivo_path];state.documents['coleta|1']={...doc,usuario_id:'coleta',arquivo_path:path,nome:'Ana.pdf'}});
   await page.locator('#relatorioUsuarios').click();await ready(page);
   assert.equal(await viewer.locator('.anotacao').count(),0);
   await viewer.locator('#notaConcluida').click();await viewer.locator('.pagina').first().click({position:{x:45,y:60}});await viewer.locator('.anotacao.concluida').waitFor();
   const foreign=await page.evaluate(()=>Object.values(window.__state.annotations).find(n=>n.usuario_id==='coleta'));
   assert(foreign);assert.equal(foreign.criado_por,'test');
   await page.locator('#relatorioMeus').click();await ready(page);
   assert.equal(await viewer.locator('.anotacao').count(),3);
  }
  // Replacing the daily PDF clears only that file's marks, including a delayed read.
  await page.evaluate(()=>{window.__annotationDelay=300;window.__annotationStarted=false});
  await viewer.locator('#notaAtualizar').click();await page.waitForFunction(()=>window.__annotationStarted);
  await page.locator('#relatorioArquivoPdf').setInputFiles({name:'Novo-dia.pdf',mimeType:'application/pdf',buffer:pdfFixture()});
  await ready(page);await page.waitForTimeout(350);
  assert.equal(await viewer.locator('.anotacao').count(),0);
  assert.equal(await page.locator('#relatorioPdfStatus').innerText(),'Novo-dia.pdf');
  const afterReplace=await page.evaluate(()=>Object.values(window.__state.annotations));
  assert.equal(afterReplace.filter(n=>n.usuario_id==='test').length,0);
  if(perfil==='admin')assert.equal(afterReplace.filter(n=>n.usuario_id==='coleta').length,1);
  await page.evaluate(()=>{window.__annotationDelay=0;window.__state.user.perfil='operador_conferencia';return atualizarInterfaceSessao()});
  assert.equal(await page.locator('#relatorioPdfViewer').count(),0);
  assert.equal(await page.locator('#relatorioView').isVisible(),false);
  assert.deepEqual(errors,[]);results.push({width,perfil,annotations:true,persistence:true,print:true,zoom:true,fileAndOwnerIsolation:true,errorRecovery:true});await ctx.close();
 }
 console.log(JSON.stringify(results));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
