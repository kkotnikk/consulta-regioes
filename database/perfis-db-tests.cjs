// Run with @electric-sql/pglite available through node_modules or NODE_PATH.
const {PGlite}=require('@electric-sql/pglite');
const fs=require('fs'),assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();await db.exec(fs.readFileSync(__dirname+'/perfis-test-fixture.sql','utf8'));
 await db.exec(fs.readFileSync(__dirname+'/perfis-individuais.sql','utf8'));
 const uid=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
 assert.deepEqual((await db.query("select perfil,ativo from usuarios where id=$1",[uid(2)])).rows[0],{perfil:'operador_coleta',ativo:false});
 await db.query("update usuarios set ativo=true,rotas_coleta_ids='{1,2}' where id=$1",[uid(2)]);
 await db.query("insert into usuarios(id,nome,perfil,ativo) values($1,'Conferente','operador_conferencia',true),($2,'Inativo','operador_conferencia',false)",[uid(3),uid(4)]);
 async function as(n,fn){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?uid(n):'']);await db.exec('set role '+(n?'authenticated':'anon'));try{return await fn()}finally{await db.exec('reset role')}}
 const returning=id=>db.query('select public.registrar_retornando_base($1)',[id]);
 const confirm=id=>db.query('select public.confirmar_retorno_rota($1)',[id]);
 const count=async t=>(await db.query('select * from public.'+t)).rows.length;
 await as(2,async()=>{
  assert.equal(await count('rotas'),8);
  await returning(1);await returning(2);
  await assert.rejects(()=>returning(3),/atribuído/);
  await assert.rejects(()=>confirm(1),/Conferência/);
  assert.equal((await db.query("update usuarios set perfil='admin',rotas_coleta_ids='{}' where id=$1 returning id",[uid(2)])).rows.length,0);
  assert.equal((await db.query("update rotas set motorista='Ataque' where id=3 returning id")).rows.length,0);
  await assert.rejects(()=>db.query("insert into bairros values(1,'Ataque','X')"),/row-level security/);
 });
 await as(3,async()=>{
  assert.equal(await count('rotas'),8);
  await assert.rejects(()=>returning(3),/atribuído/);
  await confirm(1);await confirm(3);
  assert.equal(await count('historico_rotas'),0);
  assert.equal(await count('usuarios'),1);
 });
 await as(4,async()=>{assert.equal(await count('rotas'),0);await assert.rejects(()=>confirm(4),/acesso/);await assert.rejects(()=>returning(4),/atribuído/)});
 await as(0,async()=>{assert.equal(await count('rotas'),0);await assert.rejects(()=>confirm(4),/permission denied/);await db.query('insert into sugestoes values(1)');await db.query('insert into suporte_chamados values(1)')});
 await as(1,async()=>{
  assert.equal(await count('usuarios'),4);
  assert.equal((await db.query("select consulta_regioes_private.usuario_tem_permissao(array['permissao_futura']) as ok")).rows[0].ok,true);
  await returning(4);await confirm(4);
  await assert.rejects(()=>db.query("update usuarios set perfil='operador_conferencia' where id=$1",[uid(1)]),/próprio acesso/);
  await assert.rejects(()=>db.query("update usuarios set rotas_coleta_ids='{1,1}' where id=$1",[uid(2)]),/diferentes/);
  await assert.rejects(()=>db.query("update usuarios set rotas_coleta_ids='{1,99}' where id=$1",[uid(2)]),/existentes/);
  await assert.rejects(()=>db.query("update usuarios set rotas_coleta_ids='{1,2,3}' where id=$1",[uid(2)]),/diferentes/);
  await assert.rejects(()=>db.query("update usuarios set rotas_coleta_ids='{1}' where id=$1",[uid(2)]),/diferentes/);
  await assert.rejects(()=>db.query("delete from rotas where id=1"),/atribuída/);
  await db.query("insert into bairros values(1,'Lapa','X')");
  assert.equal(await count('sugestoes'),1);assert.equal(await count('suporte_chamados'),1);
 });
 assert.equal((await db.query('select * from historico_rotas')).rows.length,6);
 console.log('OK: matriz dos 3 perfis, duas rotas, RLS, RPC, inativos, visitantes, privilégio futuro do admin, cadastro e proteção de atribuições.');
 await db.close();
})().catch(e=>{console.error(e);process.exit(1)});
