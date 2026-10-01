const {chromium}=require('playwright'),fs=require('fs'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const routes=[1,2,3].map(id=>({id,motorista:'Motorista '+id,placa:'ABC1D2'+id,regiao:'Lapa',status:'em_rota',numero_coletas:5}));
const stub=(perfil,ativo=true)=>'window.__state='+JSON.stringify({routes,user:{id:'test',nome:'Pessoa '+perfil,perfil,ativo,rotas_coleta_ids:perfil==='operador_coleta'?[1,2]:[]},users:[{id:'test',nome:'João',perfil:'admin',ativo:true,rotas_coleta_ids:[]},{id:'coleta',nome:'Ana',perfil:'operador_coleta',ativo:true,rotas_coleta_ids:[1,2]}],signedIn:perfil!=='anon'})+`;
window.supabase={createClient(){
 function query(table){let single=false,filter=null,patch=null;const q=new Proxy({}, {get(_,key){
  if(key==='then')return resolve=>{
   let data=table==='rotas'?window.__state.routes:table==='usuarios'?(filter?filter==='test'?[window.__state.user]:window.__state.users.filter(u=>u.id===filter):window.__state.users):[];
   if(patch){data.forEach(u=>Object.assign(u,patch));window.__lastUpdate={filter,patch};}
   resolve({data:single?data[0]||null:data,error:null});
  };
  if(key==='single'||key==='maybeSingle')return ()=>{single=true;return q};
  if(key==='eq')return (name,value)=>{if(name==='id')filter=value;return q};
  if(key==='update')return value=>{patch=value;return q};return ()=>q;
 }});return q;}
 return {auth:{getSession:async()=>({data:{session:window.__state.signedIn?{user:{id:'test'},access_token:'test-jwt'}:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>{window.__state.signedIn=false;return {error:null}}},from:query,rpc:async()=>({data:0,error:null}),removeChannel:async()=>{},channel(){const c={on(){return c},subscribe(){return c},presenceState(){return {}},track:async()=>{}};return c;}};
}};`;
(async()=>{
 const launch={headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader']};
 if(process.env.CHROMIUM_EXECUTABLE){launch.executablePath=process.env.CHROMIUM_EXECUTABLE;launch.env={...process.env,LD_LIBRARY_PATH:process.env.CHROMIUM_LIBRARY_PATH||process.env.LD_LIBRARY_PATH||''};}
 const browser=await chromium.launch(launch);
 const results=[];
 for(const width of [1280,390])for(const perfil of ['admin','operador_coleta','operador_conferencia','anon','inactive']){
  const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
  await ctx.addInitScript(()=>sessionStorage.setItem('solidez_soft_intro_v1','1'));
  let posted=null;await ctx.route('**/*',route=>{
   const url=route.request().url();
   if(url==='http://consulta.test/')return route.fulfill({contentType:'text/html',body:html});
   if(url.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:stub(perfil==='inactive'?'operador_coleta':perfil,perfil!=='inactive')});
   if(url.includes('/functions/v1/criar-usuario')){posted=JSON.parse(route.request().postData());return route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({message:'Criado',id:'new'})});}
   return route.abort();
  });
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://consulta.test/');
  await page.evaluate(async()=>{await atualizarInterfaceSessao();await carregarRotasPublicas();});
  const reportAllowed=['admin','operador_coleta'].includes(perfil),logged=!['anon','inactive'].includes(perfil);
  assert.equal(await page.locator('.nav-link[href="#relatorio"]').isVisible(),reportAllowed);
  assert.equal(await page.evaluate(()=>rotasPublicasCache.length),logged?3:0);
  for(const id of [1,3]){
   if(!logged)continue;
   await page.evaluate(id=>abrirDetalhesRota(id),id);
   assert.equal(await page.locator('#areaRegistrarRetornandoBase').isVisible(),perfil==='admin'||perfil==='operador_coleta'&&id===1);
   assert.equal(await page.locator('#areaConfirmarRetornoPublico').isVisible(),perfil==='admin'||perfil==='operador_conferencia');
   await page.evaluate(()=>{document.getElementById('modalDetalhesRota').classList.remove('ativo');document.body.style.overflow='';});
  }
  const entered=await page.evaluate(()=>alternarTelaSistema('relatorio',{imediato:true}));
  assert.equal(entered,reportAllowed);
  if(reportAllowed){
   assert.equal(await page.locator('#relatorioConteudo').innerHTML(),'');
   await page.evaluate(()=>{window.print=()=>window.__printed=true;});
   await page.locator('.relatorio-imprimir').click();await page.waitForFunction(()=>window.__printed);
   await page.evaluate(()=>{document.body.classList.remove('imprimindo-relatorio');});
  }
  if(perfil==='admin'){
   await page.evaluate(()=>mostrarPainelAdmin());
   assert.equal(await page.locator('#gerenciamentoAtalhos').isVisible(),true);
   for(const target of ['adminUsuariosFerramenta','adminBairrosFerramenta','adminNovaRotaFerramenta','adminSuporteFerramenta','adminSugestoesFerramenta','adminHistoricoFerramenta']){
    const before=await page.evaluate(()=>({panel:document.getElementById('gerenciamentoView').scrollTop,window:scrollY}));
    await page.locator('#gerenciamentoAtalhos button[aria-controls="'+target+'"]').click();
    await page.waitForTimeout(180);
    const sample=await page.evaluate(id=>{const pane=document.getElementById('gerenciamentoView'),el=document.getElementById(id);return {at:pane.scrollTop,to:['adminBairrosFerramenta','adminNovaRotaFerramenta'].includes(id)?0:Math.max(0,Math.min(pane.scrollTop+el.getBoundingClientRect().top-pane.getBoundingClientRect().top-22,pane.scrollHeight-pane.clientHeight)),window:scrollY}},target);
    if(Math.abs(sample.to-before.panel)>5)assert(sample.at>Math.min(before.panel,sample.to)&&sample.at<Math.max(before.panel,sample.to),JSON.stringify(sample));
    assert.equal(sample.window,before.window);
    await page.waitForFunction(id=>document.activeElement===document.getElementById(id).querySelector('h3'),target);
    assert.equal(await page.locator('#gerenciamentoAtalhos button[aria-controls="'+target+'"]').getAttribute('aria-current'),'location');
   }
   const menu=await page.locator('.sidebar').boundingBox();assert.equal(menu.y,0);
   await page.locator('#gerenciamentoAtalhos button[aria-controls="adminUsuariosFerramenta"]').click();
   await page.waitForFunction(()=>document.activeElement===document.getElementById('adminUsuariosFerramenta').querySelector('h3'));
   await page.getByRole('button',{name:'Cadastrar usuário',exact:true}).click();
   await page.locator('#usuarioNome').fill('Maria');
   await page.locator('#usuarioEmail').fill('maria@example.test');
   await page.locator('#usuarioSenha').fill('SenhaTest123!');
   await page.locator('#usuarioRota1').selectOption('1');
   await page.locator('#usuarioRota2').selectOption('1');
   await page.locator('#usuarioSalvar').click();
   assert.match(await page.locator('#usuarioFormErro').innerText(),/diferentes/);
   assert.equal(posted,null);
   await page.locator('#usuarioRota2').selectOption('2');
   await page.locator('#usuarioRota3').selectOption('3');
   await page.locator('#usuarioSalvar').click();await page.waitForFunction(()=>document.getElementById('formUsuario').hidden);
   assert.equal(posted.nome,'Maria');assert.equal(posted.perfil,'operador_coleta');assert.deepEqual(posted.rotas_coleta_ids,[1,2,3]);
   await page.evaluate(()=>abrirCadastroUsuario('coleta'));
   assert.equal(await page.locator('#usuarioNome').inputValue(),'Ana');
   assert.equal(await page.locator('#usuarioCredenciais').isVisible(),false);
   await page.locator('#usuarioPerfil').selectOption('operador_conferencia');
   assert.equal(await page.locator('#usuarioRotasColeta').isVisible(),false);
   await page.locator('#usuarioSalvar').click();await page.waitForFunction(()=>document.getElementById('formUsuario').hidden);
   assert.deepEqual(await page.evaluate(()=>window.__lastUpdate.patch.rotas_coleta_ids),[]);
   assert.equal(await page.evaluate(()=>window.__lastUpdate.patch.perfil),'operador_conferencia');
   await page.evaluate(()=>abrirCadastroUsuario('test'));
   assert.equal(await page.locator('#usuarioTerceiraRota').isVisible(),true);
   assert.equal(await page.locator('#usuarioRota1').evaluate(el=>el.required),false);
   await page.locator('#usuarioRota1').selectOption('1');
   await page.locator('#usuarioRota2').selectOption('2');
   await page.locator('#usuarioRota3').selectOption('3');
   await page.locator('#usuarioSalvar').click();await page.waitForFunction(()=>document.getElementById('formUsuario').hidden);
   assert.deepEqual(await page.evaluate(()=>window.__lastUpdate.patch.rotas_coleta_ids),[1,2,3]);
   assert.equal(await page.evaluate(()=>usuarioPodeRetornarRota(3)),true);
   await page.evaluate(()=>abrirCadastroUsuario());
   await page.screenshot({path:__dirname+'/usuarios-'+width+'.png',fullPage:false});
   const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
   assert(dimensions.scroll<=dimensions.width,JSON.stringify(dimensions));
  }
  if(perfil==='operador_coleta'){
   await page.evaluate(()=>{window.__state.user.perfil='operador_conferencia';return atualizarInterfaceSessao();});
   assert.equal(await page.locator('#relatorioView').isVisible(),false);
  }
  assert.deepEqual(errors,[]);results.push({width,perfil,ok:true});await ctx.close();
 }
 console.log(JSON.stringify(results));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});

