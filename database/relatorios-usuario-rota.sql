-- Um PDF atual para cada combinação de usuário e rota.
-- O relatório global legado permanece preservado, sem acesso dos clientes.
revoke all on public.relatorio_documentos from anon,authenticated;
drop policy relatorio_leitura on public.relatorio_documentos;
drop policy relatorio_envio on public.relatorio_documentos;
drop policy relatorio_substituicao on public.relatorio_documentos;
drop policy relatorio_pdf_leitura on storage.objects;
drop policy relatorio_pdf_envio on storage.objects;
drop policy relatorio_pdf_limpeza on storage.objects;

create function consulta_regioes_private.usuario_pode_acessar_relatorio_rota(dono uuid,rota bigint)
returns boolean language sql stable security definer set search_path='' as $$
 select (select consulta_regioes_private.usuario_tem_permissao('{}'::text[]))
 or ((select consulta_regioes_private.usuario_tem_permissao(array['operador_coleta']::text[]))
 and dono=(select auth.uid())
 and exists(select 1 from public.usuarios u where u.id=(select auth.uid()) and rota=any(u.rotas_coleta_ids)));
$$;
revoke all on function consulta_regioes_private.usuario_pode_acessar_relatorio_rota(uuid,bigint) from public,anon;
grant execute on function consulta_regioes_private.usuario_pode_acessar_relatorio_rota(uuid,bigint) to authenticated;

create table public.relatorios_por_rota(
 usuario_id uuid not null references auth.users(id),
 rota_id bigint not null references public.rotas(id),
 arquivo_path text not null unique,
 nome text not null check(length(btrim(nome)) between 1 and 255),
 enviado_por uuid not null references auth.users(id),
 atualizado_em timestamptz not null default now(),
 primary key(usuario_id,rota_id),
 check(split_part(arquivo_path,'/',1)=usuario_id::text and split_part(arquivo_path,'/',2)=rota_id::text
 and arquivo_path ~ '^[0-9a-f-]{36}/[0-9]{1,18}/[0-9a-f-]{36}\.pdf$')
);
create index relatorios_por_rota_rota_idx on public.relatorios_por_rota(rota_id);
create index relatorios_por_rota_enviado_idx on public.relatorios_por_rota(enviado_por);
alter table public.relatorios_por_rota enable row level security;
revoke all on public.relatorios_por_rota from anon,authenticated;
grant select,insert,update on public.relatorios_por_rota to authenticated;
create policy relatorios_rota_leitura on public.relatorios_por_rota for select to authenticated
 using(consulta_regioes_private.usuario_pode_acessar_relatorio_rota(usuario_id,rota_id));
create policy relatorios_rota_envio on public.relatorios_por_rota for insert to authenticated
 with check(consulta_regioes_private.usuario_pode_acessar_relatorio_rota(usuario_id,rota_id) and enviado_por=(select auth.uid()));
create policy relatorios_rota_substituicao on public.relatorios_por_rota for update to authenticated
 using(consulta_regioes_private.usuario_pode_acessar_relatorio_rota(usuario_id,rota_id))
 with check(consulta_regioes_private.usuario_pode_acessar_relatorio_rota(usuario_id,rota_id) and enviado_por=(select auth.uid()));

create function consulta_regioes_private.validar_relatorio_rota()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and (new.usuario_id is distinct from old.usuario_id or new.rota_id is distinct from old.rota_id) then
  raise exception 'O usuário e a rota deste relatório não podem ser alterados.';
 end if;
 new.enviado_por:=auth.uid();new.atualizado_em:=now();return new;
end;
$$;
revoke all on function consulta_regioes_private.validar_relatorio_rota() from public,anon,authenticated;
create trigger validar_relatorio_rota before insert or update on public.relatorios_por_rota
for each row execute function consulta_regioes_private.validar_relatorio_rota();

-- Validação antes dos casts: caminhos legados ou malformados não autorizam acesso.
create function consulta_regioes_private.usuario_pode_enviar_pdf_rota(caminho text)
returns boolean language sql stable security invoker set search_path='' as $$
 select case when caminho ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{1,18}/[0-9a-f-]{36}\.pdf$'
 then consulta_regioes_private.usuario_pode_acessar_relatorio_rota(split_part(caminho,'/',1)::uuid,split_part(caminho,'/',2)::bigint)
 else false end;
$$;
revoke all on function consulta_regioes_private.usuario_pode_enviar_pdf_rota(text) from public,anon;
grant execute on function consulta_regioes_private.usuario_pode_enviar_pdf_rota(text) to authenticated;
create policy relatorio_rota_pdf_leitura on storage.objects for select to authenticated
 using(bucket_id='relatorios' and consulta_regioes_private.usuario_pode_enviar_pdf_rota(name));
create policy relatorio_rota_pdf_envio on storage.objects for insert to authenticated
 with check(bucket_id='relatorios' and consulta_regioes_private.usuario_pode_enviar_pdf_rota(name));
create policy relatorio_rota_pdf_limpeza on storage.objects for delete to authenticated
 using(bucket_id='relatorios' and consulta_regioes_private.usuario_pode_enviar_pdf_rota(name)
 and not exists(select 1 from public.relatorios_por_rota r where r.arquivo_path=storage.objects.name));
