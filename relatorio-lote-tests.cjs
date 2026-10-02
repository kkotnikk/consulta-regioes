const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const inicio=html.indexOf('const loteRelatorios ='),fim=html.indexOf('async function imprimirRelatorio()',inicio);
assert(inicio>0&&fim>inicio);
const elementos=new Map(),uploads=[],chamadas=[];
const elemento=id=>{
 if(!elementos.has(id))elementos.set(id,{innerHTML:'',textContent:'',disabled:false,classList:{contains:()=>true,toggle(){}},addEventListener(){},focus(){}});
 return elementos.get(id);
};
const rotas=[{id:27,motorista:'Pedro',placa:'QCL1D67'},{id:29,motorista:'Ana',placa:'ABC1234'}];
const usuarios=[{id:'usuario-1',nome:'João',rotas_coleta_ids:[27]},{id:'usuario-2',nome:'Eloiza',rotas_coleta_ids:[27,29]}];
const contexto={document:{getElementById:elemento},rotasPublicasCache:rotas,crypto:{randomUUID:()=>String(uploads.length+1).padStart(36,'0')},
 escapeHtml:valor=>String(valor).replaceAll('&','&amp;').replaceAll('<','&lt;'),
 usuarioAtualSistema:{id:'usuario-2'},obterUsuarioAtualSistema:async()=>({id:'usuario-2'}),
 usuarioTemPermissao:perfis=>perfis.length>0,mostrarToast(){},carregarRotasPublicas:async()=>{},
 limparPdfRelatorio(){},renderizarRelatorio(){},carregarPdfRelatorio:async()=>{},
 supabaseClient:{storage:{from(){return {async upload(path){uploads.push(path);return {error:null}},async remove(){return {error:null}}}}},
  async rpc(nome,args){chamadas.push({nome,args});if(nome==='distribuir_relatorio_rota')return {data:{destinatarios:usuarios,usuario_total_id:'usuario-2'},error:null};return {data:usuarios,error:null}}},
};
vm.createContext(contexto);
vm.runInContext(html.slice(inicio,fim)+`\nglobalThis.testeLote={normalizarNomeRotaLote,sugerirRotaLote,destinatariosRotaLote,loteRelatorios,adicionarArquivosLote,distribuirArquivosLote};lerTotalArquivoLote=async()=>true;`,contexto);
const api=contexto.testeLote;
assert.equal(api.sugerirRotaLote('Pedro.pdf'),27);
assert.equal(api.sugerirRotaLote('Rota Pedro.pdf'),27);
assert.equal(api.sugerirRotaLote('QCL1D67.pdf'),27);
assert.equal(api.sugerirRotaLote('Desconhecido.pdf'),null);
rotas.push({id:31,motorista:'Pedro',placa:'ABC9999'});
assert.equal(api.sugerirRotaLote('Pedro.pdf'),null,'nomes duplicados exigem escolha manual');
rotas.pop();
api.loteRelatorios.usuarios=usuarios;api.loteRelatorios.atorId='usuario-2';
const arquivo={name:'Pedro.pdf',size:1234,slice:()=>({text:async()=>'%PDF-'}),arrayBuffer:async()=>new ArrayBuffer(0)};
(async()=>{
 await api.adicionarArquivosLote([arquivo]);
 assert.equal(api.loteRelatorios.arquivos[0].rotaId,27);
 assert.equal(api.destinatariosRotaLote(27).length,2);
 assert.match(elemento('relatorioLoteLista').innerHTML,/João, Eloiza/);
 await api.distribuirArquivosLote();
 assert.equal(uploads.length,2);
 assert(uploads.some(path=>path.startsWith('usuario-1/27/')));
 assert(uploads.some(path=>path.startsWith('usuario-2/27/')));
 assert.equal(chamadas[0].nome,'distribuir_relatorio_rota');
 assert.equal(chamadas[0].args.p_arquivos.length,2);
 assert.equal(api.loteRelatorios.arquivos[0].estado,'enviado');
 console.log('OK: Pedro.pdf → rota Pedro → dois usuários vinculados, com confirmação.');
})().catch(error=>{console.error(error);process.exitCode=1});
