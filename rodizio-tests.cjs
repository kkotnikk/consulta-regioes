const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const calendario=html.split('/* RODIZIO_CALENDARIO_INICIO */')[1].split('/* RODIZIO_CALENDARIO_FIM */')[0];
const sandbox={Date,Intl};vm.runInNewContext(calendario,sandbox);
const estado=(placa,dia)=>sandbox.rodizioDaPlaca(placa,new Date(dia))?.estado||null;
for(const [dia,finais] of [['2026-10-05',[1,2]],['2026-10-06',[3,4]],['2026-10-07',[5,6]],['2026-10-08',[7,8]],['2026-10-09',[9,0]]])for(const final of finais)assert.equal(estado('ABC1D2'+final,dia+'T15:00:00Z'),'hoje');
assert.equal(estado('CLU3J50','2026-10-01T21:00:00Z'),'amanha');
assert.equal(estado('abc-1234','2026-10-06T15:00:00Z'),'hoje');
assert.equal(estado('ABC1D27','2026-10-02T02:59:59Z'),'hoje');
assert.equal(estado('ABC1D27','2026-10-02T03:00:00Z'),null);
assert.equal(estado('ABC1D20','2026-10-02T03:00:00Z'),'hoje');
assert.equal(estado('ABC1D21','2026-10-09T15:00:00Z'),null);
assert.equal(estado('ABC1D21','2026-10-04T15:00:00Z'),'amanha');
assert.equal(estado('ABC1D21','2026-10-11T15:00:00Z'),null); // Amanhã é feriado.
for(const [data,final] of [['2026-01-01',7],['2026-04-03',0],['2026-06-04',7],['2026-07-09',8],['2026-09-07',1],['2026-11-20',9]])assert.equal(estado('ABC1D2'+final,data+'T15:00:00Z'),null);
assert.equal(estado('ABC1D20','2026-07-10T15:00:00Z'),'hoje'); // Emenda não libera caminhões.
assert.equal(estado('ABC1D21','2026-02-16T15:00:00Z'),'hoje'); // Carnaval é ponto facultativo.
for(const placa of ['', 'ABC', 'ABC123', '<img src=x>0','ABC1D2X'])assert.equal(estado(placa,'2026-10-01T21:00:00Z'),null);
const fixture={require,__dirname};vm.runInNewContext(fs.readFileSync(__dirname+'/perfis-ui-tests.cjs','utf8').split('(async()=>{')[0]+'\nthis.stubAdmin=stub("admin");',fixture);
const stub=fixture.stubAdmin.replace("table==='rotas'?window.__state.routes:","table==='historico_rotas'?[{acao:'rota_criada',placa:'ABC1D27',motorista:'Teste',regiao:'Lapa'}]:table==='rotas'?window.__state.routes:");
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,headless:true,args:['--no-sandbox','--disable-dev-shm-usage'],env:{...process.env,LD_LIBRARY_PATH:process.env.CHROMIUM_LIBRARY_PATH||''}}),results=[];
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:900},timezoneId:'Pacific/Honolulu',reducedMotion:'reduce'});
  await context.addInitScript(()=>{
   sessionStorage.setItem('solidez_soft_intro_v1','1');window.__agora=Date.parse('2026-10-01T21:00:00Z');
   const RealDate=Date;window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[window.__agora]));}static now(){return window.__agora;}};
  });
  await context.route('**/*',route=>{const url=route.request().url();if(url==='http://consulta.test/')return route.fulfill({contentType:'text/html',body:html});if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:stub});return route.abort();});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://consulta.test/');
  await page.evaluate(async()=>{window.__state.routes[0].placa='ABC1D27';window.__state.routes[1].placa='CLU3J50';window.__state.user.rotas_coleta_ids=[1,2,3];await atualizarInterfaceSessao();await carregarRotasPublicas();await mostrarPainelAdmin();});
  assert.equal(await page.locator('#rotasPublicas .rodizio-hoje').first().innerText(),'Rodízio hoje');
  assert.equal(await page.locator('#rotasPublicas .rodizio-amanha').first().innerText(),'Rodízio amanhã');
  assert((await page.locator('#adminRotasLista .rodizio-hoje').count())>=1);
  assert.equal(await page.locator('#adminHistoricoRotas .rodizio-hoje').innerText(),'Rodízio hoje');
  await page.evaluate(()=>abrirDetalhesRota(1));assert.equal(await page.locator('#detalhesPlaca .rodizio-hoje').innerText(),'Rodízio hoje');
  await page.waitForTimeout(1200);await page.locator('#detalhesPlaca').screenshot({path:__dirname+'/rodizio-placa-'+width+'.png',animations:'disabled'});
  await page.evaluate(()=>{document.getElementById('modalDetalhesRota').classList.remove('ativo');document.body.style.overflow='';});
  await page.locator('#novaPlaca').fill('CLU3J50');assert.equal(await page.locator('#novaPlacaRodizio .rodizio-amanha').innerText(),'Rodízio amanhã');
  await page.locator('#novaPlaca').fill('ABC1D27');assert.equal(await page.locator('#novaPlacaRodizio .rodizio-hoje').innerText(),'Rodízio hoje');
  await page.locator('#novaPlaca').fill('ABC');assert.equal(await page.locator('#novaPlacaRodizio').isVisible(),false);
  await page.locator('#novaPlaca').fill('ABC1D27');
  await page.evaluate(()=>editarRota(1));assert.equal(await page.locator('#editarPlacaRodizio .rodizio-hoje').innerText(),'Rodízio hoje');
  await page.locator('#editarPlaca').fill('CLU3J50');assert.equal(await page.locator('#editarPlacaRodizio .rodizio-amanha').innerText(),'Rodízio amanhã');
  await page.waitForTimeout(1200);await page.screenshot({path:__dirname+'/rodizio-editar-'+width+'.png',animations:'disabled'});
  await page.evaluate(()=>fecharEdicaoRota());
  await page.evaluate(()=>{const modal=document.getElementById('modalAdicionarRota');modal.classList.add('ativo');modal.setAttribute('aria-hidden','false');});
  await page.locator('#modalNovaPlaca').fill('CLU3J50');assert.equal(await page.locator('#modalNovaPlacaRodizio .rodizio-amanha').innerText(),'Rodízio amanhã');
  await page.evaluate(()=>fecharAdicionarRota());
  await page.evaluate(()=>abrirCadastroUsuario());await page.locator('#usuarioRota1').selectOption('1');
  assert.match(await page.locator('#usuarioRota1 option:checked').innerText(),/Rodízio hoje/);
  assert.equal(await page.locator('#usuarioRotasLista .rodizio-hoje').innerText(),'Rodízio hoje');
  await page.evaluate(()=>fecharCadastroUsuario());
  await page.evaluate(()=>alternarTelaSistema('relatorio',{imediato:true}));
  assert.equal(await page.locator('#relatorioRota .rodizio-hoje').innerText(),'Rodízio hoje');
  await page.locator('#relatorioPagina2').click();assert.equal(await page.locator('#relatorioRota .rodizio-amanha').innerText(),'Rodízio amanhã');
  await page.evaluate(()=>{window.__agora=Date.parse('2026-10-02T03:00:00Z');atualizarAvisosRodizio();});
  assert.equal(await page.locator('#relatorioRota .rodizio-hoje').innerText(),'Rodízio hoje');
  assert.equal(await page.locator('#novaPlacaRodizio').getAttribute('hidden'),'');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);
  assert.deepEqual(errors,[]);results.push({width,ok:true});await context.close();
 }
 await browser.close();console.log('OK: tabela semanal, São Paulo, virada do dia, feriados e placas inválidas; '+JSON.stringify(results));
})().catch(error=>{console.error(error);process.exit(1)});
