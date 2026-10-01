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
 const uid=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
 await db.query("update usuarios set ativo=true,rotas_coleta_ids='{1}' where id=$1",[uid(2)]);
 await db.query("insert into usuarios(id,nome,perfil,ativo) values($1,'Conferência','operador_conferencia',true),($2,'Inativo','operador_coleta',false)",[uid(3),uid(4)]);
 async function as(n,fn){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?uid(n):'']);await db.exec('set role '+(n?'authenticated':'anon'));try{return await fn()}finally{await db.exec('reset role')}}
 const bucket=(await db.query('select * from storage.buckets')).rows[0];
 assert.equal(bucket.public,false);assert.equal(Number(bucket.file_size_limit),20971520);assert.deepEqual(bucket.allowed_mime_types,['application/pdf']);
 await as(2,async()=>{
  await db.query("insert into storage.objects(bucket_id,name) values('relatorios',$1)",[uid(2)+'/coleta.pdf']);
  await db.query("insert into relatorio_documentos(id,nome,arquivo_path,enviado_por) values(1,'Coleta.pdf',$1,$2)",[uid(2)+'/coleta.pdf',uid(1)]);
  assert.equal((await db.query('select enviado_por from relatorio_documentos')).rows[0].enviado_por,uid(2));
  assert.equal((await db.query('delete from storage.objects returning id')).rows.length,0);
  await db.query("insert into storage.objects(bucket_id,name) values('relatorios',$1)",[uid(2)+'/falhou.pdf']);
  assert.equal((await db.query('delete from storage.objects where name=$1 returning id',[uid(2)+'/falhou.pdf'])).rows.length,1);
  await assert.rejects(()=>db.query("insert into storage.objects(bucket_id,name) values('relatorios',$1)",[uid(1)+'/falso.pdf']),/row-level security/);
 });
 await as(1,async()=>{
  assert.equal((await db.query('select * from relatorio_documentos')).rows.length,1);
  assert.equal((await db.query("select * from storage.objects where bucket_id='relatorios'")).rows.length,1);
  await db.query("insert into storage.objects(bucket_id,name) values('relatorios',$1)",[uid(1)+'/admin.pdf']);
  await db.query("update relatorio_documentos set nome='Admin.pdf',arquivo_path=$1 where id=1",[uid(1)+'/admin.pdf']);
 });
 for(const n of [3,4]){
  await as(n,async()=>{
   assert.equal((await db.query('select * from relatorio_documentos')).rows.length,0);
   assert.equal((await db.query('select * from storage.objects')).rows.length,0);
   await assert.rejects(()=>db.query("insert into storage.objects(bucket_id,name) values('relatorios',$1)",[uid(n)+'/negado.pdf']),/row-level security/);
   assert.equal((await db.query("update relatorio_documentos set nome='Ataque' returning id")).rows.length,0);
  });
 }
 await as(0,async()=>{assert.equal((await db.query('select * from storage.objects')).rows.length,0);await assert.rejects(()=>db.query('select * from relatorio_documentos'),/permission denied/)});
 console.log('OK: PDF privado, limite de tamanho e tipo, envio/edição/leitura Coleta + Admin, Conferência/visitantes/inativos bloqueados, limpeza somente de uploads não vinculados.');
 await db.close();
})().catch(e=>{console.error(e);process.exit(1)});

