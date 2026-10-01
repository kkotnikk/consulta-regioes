const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
(async()=>{
 const db=new PGlite();
 await db.exec(fs.readFileSync(__dirname+'/perfis-test-fixture.sql','utf8'));
 await db.exec(fs.readFileSync(__dirname+'/perfis-individuais.sql','utf8'));
 await db.exec(fs.readFileSync(__dirname+'/rotas-por-perfil.sql','utf8'));
 await db.exec(`create schema storage;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text);
 create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;
 alter table storage.objects enable row level security;
 grant usage on schema storage to authenticated,anon;
 grant select,insert,delete on storage.objects to authenticated;
 grant select on storage.objects to anon;`);
 await db.exec(fs.readFileSync(__dirname+'/relatorio-pdf.sql','utf8'));
 await db.exec(fs.readFileSync(__dirname+'/relatorios-usuario-rota.sql','utf8'));
 const uid=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
 await db.query("update usuarios set ativo=true,rotas_coleta_ids='{1,2,3}' where id=$1",[uid(2)]);
 await db.query("insert into usuarios(id,nome,perfil,ativo,rotas_coleta_ids) values($1,'Outra pessoa','operador_coleta',true,'{1}'),($2,'Inativo','operador_coleta',false,'{}')",[uid(3),uid(4)]);
 await db.query('insert into auth.users(id) values($1)',[uid(5)]);
 await db.query("insert into usuarios(id,nome,perfil,ativo,rotas_coleta_ids) values($1,'Conferência','operador_conferencia',true,'{}')",[uid(5)]);
 async function as(n,fn){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?uid(n):'']);await db.exec('set role '+(n?'authenticated':'anon'));try{return await fn()}finally{await db.exec('reset role')}}
 const path=(n,r,file=1)=>uid(n)+'/'+r+'/'+uid(file)+'.pdf';
 const bucket=(await db.query('select * from storage.buckets')).rows[0];
 assert.equal(bucket.public,false);assert.equal(Number(bucket.file_size_limit),20971520);
 async function upload(n,r,file=1){
  const arquivo=path(n,r,file);
  await db.query("insert into storage.objects(bucket_id,name) values('relatorios',$1)",[arquivo]);
  await db.query("insert into relatorios_por_rota(usuario_id,rota_id,nome,arquivo_path,enviado_por) values($1,$2,'Relatorio.pdf',$3,$1) on conflict(usuario_id,rota_id) do update set arquivo_path=excluded.arquivo_path",[uid(n),r,arquivo]);
 }
 await as(2,async()=>{
  for(const r of [1,2,3])await upload(2,r);
  assert.equal((await db.query('select * from relatorios_por_rota')).rows.length,3);
  await assert.rejects(()=>upload(2,4),/row-level security/);
  await assert.rejects(()=>upload(3,1,2),/row-level security/);
  await assert.rejects(()=>db.query("insert into relatorios_por_rota(usuario_id,rota_id,nome,arquivo_path,enviado_por) values($1,1,'Duplicado',$2,$1)",[uid(2),path(2,1)]),/duplicate key/);
  assert.equal((await db.query("delete from storage.objects where name=$1 returning id",[path(2,1)])).rows.length,0);
  await upload(2,1,2);
  assert.equal((await db.query('select * from relatorios_por_rota')).rows.length,3);
  assert.equal((await db.query('delete from storage.objects where name=$1 returning id',[path(2,1)])).rows.length,1);
  await assert.rejects(()=>db.query("update relatorios_por_rota set rota_id=2 where rota_id=1"),/não podem ser alterados/);
 });
 await as(3,async()=>{
  assert.equal((await db.query('select * from relatorios_por_rota')).rows.length,0);
  assert.equal((await db.query('select * from storage.objects')).rows.length,0);
  await upload(3,1);
  assert.equal((await db.query('select * from relatorios_por_rota')).rows.length,1);
  assert.equal((await db.query("update relatorios_por_rota set nome='Ataque' where usuario_id=$1 returning rota_id",[uid(2)])).rows.length,0);
 });
 await as(1,async()=>{
  assert.equal((await db.query('select * from relatorios_por_rota')).rows.length,4);
  await db.query("update relatorios_por_rota set nome='Revisado' where usuario_id=$1 and rota_id=1",[uid(3)]);
  assert.equal((await db.query('select enviado_por from relatorios_por_rota where usuario_id=$1',[uid(3)])).rows[0].enviado_por,uid(1));
  await upload(1,8); // Admin não depende de rotas atribuídas para autorização.
 });
 await db.query("update usuarios set rotas_coleta_ids='{1,3}' where id=$1",[uid(2)]);
 await as(2,async()=>{
  assert.equal((await db.query('select * from relatorios_por_rota')).rows.length,2);
  assert.equal((await db.query('select * from storage.objects where name=$1',[path(2,2)])).rows.length,0);
  await assert.rejects(()=>upload(2,2,2),/row-level security/);
  await assert.rejects(()=>db.query('select * from relatorio_documentos'),/permission denied/);
 });
 for(const n of [4,5])await as(n,async()=>{
  assert.equal((await db.query('select * from relatorios_por_rota')).rows.length,0);
  assert.equal((await db.query('select * from storage.objects')).rows.length,0);
  await assert.rejects(()=>upload(n,1),/row-level security/);
 });
 await as(0,async()=>{assert.equal((await db.query('select * from storage.objects')).rows.length,0);await assert.rejects(()=>db.query('select * from relatorios_por_rota'),/permission denied/)});
 console.log('OK: um PDF por usuário/rota, três rotas independentes, isolamento entre usuários na mesma rota, substituição/limpeza, Admin completo, revogação de rota, Conferência/inativos/visitantes bloqueados.');
 await db.close();
})().catch(e=>{console.error(e);process.exit(1)});
