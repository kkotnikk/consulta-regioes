const {chromium}=require('playwright'),fs=require('fs'),assert=require('node:assert/strict');
const {stub,pdfFixture,soltarPdf}=require('./relatorio-pdf-ui-tests.cjs');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const ready=page=>page.waitForFunction(()=>document.getElementById('relatorioPdfViewer')?.contentDocument?.body?.dataset.pronto==='true');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader'],env:{...process.env,LD_LIBRARY_PATH:process.env.CHROMIUM_LIBRARY_PATH||process.env.LD_LIBRARY_PATH||''}}),results=[];
 for(const width of [1280,390]){
  const ctx=await browser.newContext({viewport:{width,height:900}});
  await ctx.addInitScript(()=>sessionStorage.setItem('solidez_soft_intro_v1','1'));
  await ctx.route('**/*',route=>{
   const url=route.request().url();
   if(url==='https://consulta.test/')return route.fulfill({contentType:'text/html',body:html});
   if(url.startsWith('https://consulta.test/relatorio-pdf-viewer.html?v='))return route.fulfill({contentType:'text/html',body:fs.readFileSync(__dirname+'/relatorio-pdf-viewer.html','utf8')});
   if(url.startsWith('https://consulta.test/relatorio-total-coletas.mjs'))return route.fulfill({contentType:'application/javascript',body:fs.readFileSync(__dirname+'/relatorio-total-coletas.mjs','utf8')});
   if(url.endsWith('/build/pdf.min.mjs'))return route.fulfill({contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:fs.readFileSync(process.env.PDFJS_MODULE_PATH||'/tmp/consulta-pdf.min.mjs','utf8')});
   if(url.endsWith('/build/pdf.worker.min.mjs'))return route.fulfill({contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:fs.readFileSync(process.env.PDFJS_WORKER_PATH||'/tmp/consulta-pdf.worker.min.mjs','utf8')});
   if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:stub('admin')});
   return route.abort();
  });
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://consulta.test/');await page.evaluate(()=>atualizarInterfaceSessao());
  await page.evaluate(base64=>{
   const state=window.__state,pdf=new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],{type:'application/pdf'});
   state.users.push({id:'inativo',nome:'Bruno',perfil:'operador_coleta',ativo:false,rotas_coleta_ids:[]});
   for(const [owner,route,name] of [['test',1,'Meu.pdf'],['coleta',1,'Ana.pdf'],['coleta',2,'Ana-rota2.pdf'],['inativo',8,'Bruno-arquivado.pdf']]){
    const path=owner+'/'+route+'/teste.pdf';state.files[path]=pdf;
    state.documents[owner+'|'+route]={usuario_id:owner,rota_id:route,nome:name,arquivo_path:path};
   }
  },pdfFixture().toString('base64'));
  assert.equal(await page.evaluate(()=>abrirRelatorio()),true);await ready(page);
  assert.equal(await page.locator('#relatorioPdfStatus').innerText(),'Meu.pdf');
  assert.equal(await page.locator('#relatorioAdminModos').isVisible(),true);
  await page.locator('#relatorioUsuarios').click();
  await page.waitForFunction(()=>!relatorioAdminCarregando&&relatorioAdminModo==='usuarios');await ready(page);
  assert.equal(await page.locator('#relatorioAdminUsuario').inputValue(),'coleta');
  assert.equal(await page.locator('#relatorioPdfStatus').innerText(),'Ana.pdf');
  assert.equal(await page.locator('#relatorioEnviarPdf').isVisible(),false);
  assert.equal(await page.locator('#relatorioPaginas button:not(:disabled)').count(),3);
  await page.evaluate(()=>{window.__printed=false;document.getElementById('relatorioPdfViewer').contentWindow.print=()=>window.__printed=true});
  await page.locator('.relatorio-imprimir').click();await page.waitForFunction(()=>window.__printed);
  await soltarPdf(page.frameLocator('#relatorioPdfViewer').locator('#paginas'),[{name:'Nao-substituir.pdf',buffer:pdfFixture()}]);
  assert.equal(await page.evaluate(()=>window.__uploads||0),0);
  await page.locator('#relatorioPagina2').click();await ready(page);
  assert.equal(await page.locator('#relatorioPdfStatus').innerText(),'Ana-rota2.pdf');
  await page.locator('#relatorioPagina3').click();await page.waitForFunction(()=>!relatorioPdfCarregando);
  assert.equal(await page.locator('#relatorioPdfViewer').count(),0);
  assert.equal(await page.locator('#relatorioSoltarPdf').isDisabled(),true);
  assert.equal(await page.locator('#relatorioSoltarPdf strong').innerText(),'Sem PDF nesta rota');
  await page.locator('#relatorioAdminUsuario').selectOption('inativo');await ready(page);
  assert.equal(await page.locator('#relatorioPdfStatus').innerText(),'Bruno-arquivado.pdf');
  assert.equal(await page.evaluate(()=>relatorioRotaId),8);
  assert.equal(await page.locator('#relatorioPaginas button:not(:disabled)').count(),1);
  const bounds=await page.evaluate(()=>{const r=el=>el.getBoundingClientRect();return {pdfBottom:r(document.getElementById('relatorioPdfViewer')).bottom,paneBottom:r(document.getElementById('relatorioView')).bottom,filterBottom:r(document.getElementById('relatorioAdminPainel')).bottom,pdfTop:r(document.getElementById('relatorioPdfViewer')).top,height:r(document.getElementById('relatorioPdfViewer')).height,overflow:document.documentElement.scrollWidth>innerWidth}});
  assert(!bounds.overflow&&bounds.pdfTop>=bounds.filterBottom&&bounds.pdfBottom<=bounds.paneBottom&&bounds.height>250,JSON.stringify(bounds));
  await page.screenshot({path:'/tmp/consulta-relatorios-admin-'+width+'.png'});
  // A late PDF must not replace the newly selected person's document.
  await page.evaluate(()=>{window.__downloadDelay=300;window.__downloadStarted=null});
  await page.locator('#relatorioAdminUsuario').selectOption('coleta');await page.waitForFunction(()=>window.__downloadStarted);
  await page.locator('#relatorioAdminUsuario').selectOption('inativo');await ready(page);
  assert.equal(await page.locator('#relatorioPdfStatus').innerText(),'Bruno-arquivado.pdf');
  await page.evaluate(()=>window.__downloadDelay=0);
  await page.locator('#relatorioMeus').click();await ready(page);
  assert.equal(await page.locator('#relatorioPdfStatus').innerText(),'Meu.pdf');
  assert.equal(await page.locator('#relatorioEnviarPdf').isVisible(),true);
  // Refresh covers more than one backend page and exposes a recoverable error.
  await page.evaluate(()=>{for(let i=0;i<505;i++)window.__state.users.push({id:'extra-'+i,nome:'Pessoa '+i,perfil:'operador_coleta',ativo:true,rotas_coleta_ids:[]});window.__adminQueryFailure=true});
  await page.locator('#relatorioUsuarios').click();await page.waitForFunction(()=>!relatorioAdminCarregando);
  assert.match(await page.locator('#relatorioAdminStatus').innerText(),/Não foi possível/);
  await page.evaluate(()=>window.__adminQueryFailure=false);
  await page.locator('#relatorioAdminAtualizar').click();await page.waitForFunction(()=>!relatorioAdminCarregando&&relatorioAdminUsuarios.length===508);
  assert.equal(await page.locator('#relatorioAdminUsuario option').count(),508);
  // Losing administrator access clears cached identities and a pending list result.
  await page.evaluate(()=>{window.__adminQueryDelay=300;window.__adminQueryStarted=false});
  await page.locator('#relatorioAdminAtualizar').click();await page.waitForFunction(()=>window.__adminQueryStarted);
  await page.evaluate(()=>{window.__state.user={...window.__state.user,id:'coleta',nome:'Ana',perfil:'operador_coleta'};return atualizarInterfaceSessao()});
  await page.waitForTimeout(400);
  assert.deepEqual(await page.evaluate(()=>({usuarios:relatorioAdminUsuarios.length,documentos:relatorioAdminDocumentos.length,modo:relatorioAdminModo})),{usuarios:0,documentos:0,modo:'meus'});
  assert.equal(await page.locator('#relatorioAdminModos').isVisible(),false);
  assert.equal(await page.locator('#relatorioAdminUsuario option').count(),1);
  assert.equal(await page.locator('#relatorioPdfViewer').count(),0);
  assert.equal(await page.evaluate(()=>alternarModoRelatoriosAdmin('usuarios')),false);
  await page.evaluate(()=>carregarPdfRelatorio());await ready(page);
  assert.equal(await page.locator('#relatorioPdfStatus').innerText(),'Ana.pdf');
  // Refresh itself rechecks the role, even without a preceding auth UI update.
  await page.evaluate(()=>{window.__adminQueryDelay=0;window.__state.user={...window.__state.user,id:'test',perfil:'admin'};return atualizarInterfaceSessao()});
  await page.locator('#relatorioUsuarios').click();await page.waitForFunction(()=>!relatorioAdminCarregando);
  await page.locator('#relatorioAdminUsuario').selectOption('inativo');await ready(page);
  await page.evaluate(()=>{window.__state.user.perfil='operador_conferencia';return carregarRelatoriosAdmin()});
  assert.equal(await page.locator('#relatorioAdminModos').isVisible(),false);
  assert.equal(await page.locator('#relatorioAdminUsuario option').count(),1);
  assert.equal(await page.locator('#relatorioPdfViewer').count(),0);
  await page.evaluate(()=>{window.__state.signedIn=false;return atualizarInterfaceSessao()});
  assert.equal(await page.locator('#relatorioView').isVisible(),false);
  assert.equal(await page.locator('#relatorioPdfViewer').count(),0);
  assert.deepEqual(errors,[]);results.push({width,adminOwnAndForeignReports:true,archivedAndInactive:true,pagination:true,sessionIsolation:true});await ctx.close();
 }
 console.log(JSON.stringify(results));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
