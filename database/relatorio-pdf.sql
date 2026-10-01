-- PDF compartilhado do relatório. Somente Coleta e Administrador ativos.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('relatorios','relatorios',false,20971520,array['application/pdf'])
on conflict(id) do update set public=false,file_size_limit=20971520,allowed_mime_types=array['application/pdf'];

create table public.relatorio_documentos(
 id smallint primary key default 1 check(id=1),
 arquivo_path text not null,
 nome text not null check(length(btrim(nome)) between 1 and 255),
 enviado_por uuid not null references auth.users(id),
 atualizado_em timestamptz not null default now()
);
alter table public.relatorio_documentos enable row level security;
grant select,insert,update on public.relatorio_documentos to authenticated;
create policy relatorio_leitura on public.relatorio_documentos for select to authenticated
 using((select consulta_regioes_private.usuario_tem_permissao(array['operador_coleta']::text[])));
create policy relatorio_envio on public.relatorio_documentos for insert to authenticated
 with check((select consulta_regioes_private.usuario_tem_permissao(array['operador_coleta']::text[]))
 and enviado_por=(select auth.uid()) and split_part(arquivo_path,'/',1)=(select auth.uid())::text);
create policy relatorio_substituicao on public.relatorio_documentos for update to authenticated
 using((select consulta_regioes_private.usuario_tem_permissao(array['operador_coleta']::text[])))
 with check((select consulta_regioes_private.usuario_tem_permissao(array['operador_coleta']::text[]))
 and enviado_por=(select auth.uid()) and split_part(arquivo_path,'/',1)=(select auth.uid())::text);

create or replace function consulta_regioes_private.marcar_envio_relatorio()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 new.enviado_por:=auth.uid();
 new.atualizado_em:=now();
 return new;
end;
$$;
revoke all on function consulta_regioes_private.marcar_envio_relatorio() from public,anon,authenticated;
create trigger marcar_envio_relatorio before insert or update on public.relatorio_documentos
for each row execute function consulta_regioes_private.marcar_envio_relatorio();

create policy relatorio_pdf_leitura on storage.objects for select to authenticated
 using(bucket_id='relatorios' and (select consulta_regioes_private.usuario_tem_permissao(array['operador_coleta']::text[])));
create policy relatorio_pdf_envio on storage.objects for insert to authenticated
 with check(bucket_id='relatorios'
 and (select consulta_regioes_private.usuario_tem_permissao(array['operador_coleta']::text[]))
 and (storage.foldername(name))[1]=(select auth.uid())::text);
-- Limpeza apenas de uploads próprios que falharam antes de vincular ao relatório.
create policy relatorio_pdf_limpeza on storage.objects for delete to authenticated
 using(bucket_id='relatorios'
 and (select consulta_regioes_private.usuario_tem_permissao(array['operador_coleta']::text[]))
 and (storage.foldername(name))[1]=(select auth.uid())::text
 and not exists(select 1 from public.relatorio_documentos r where r.arquivo_path=storage.objects.name));

