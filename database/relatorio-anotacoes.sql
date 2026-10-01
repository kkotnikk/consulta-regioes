-- Marcações vinculadas ao PDF atual, separadas por usuário, rota e arquivo.
create table public.relatorio_anotacoes (
 id uuid primary key default gen_random_uuid(),
 usuario_id uuid not null,
 rota_id bigint not null,
 arquivo_path text not null,
 pagina integer not null check(pagina between 1 and 10000),
 x real not null check(x between 0 and 1),
 y real not null check(y between 0 and 1),
 tipo text not null check(tipo in ('concluida','comentario')),
 comentario text not null default '',
 criado_por uuid not null default auth.uid() references auth.users(id),
 criado_em timestamptz not null default now(),
 foreign key(usuario_id,rota_id) references public.relatorios_por_rota(usuario_id,rota_id) on delete cascade,
 check((tipo='concluida' and comentario='') or (tipo='comentario' and length(btrim(comentario)) between 1 and 300))
);
create index relatorio_anotacoes_documento_idx on public.relatorio_anotacoes(usuario_id,rota_id,arquivo_path,criado_em,id);
create index relatorio_anotacoes_autor_idx on public.relatorio_anotacoes(criado_por);
alter table public.relatorio_anotacoes enable row level security;
revoke all on public.relatorio_anotacoes from public,anon,authenticated;
grant select,insert,delete on public.relatorio_anotacoes to authenticated;
grant update(comentario) on public.relatorio_anotacoes to authenticated;

create policy anotacoes_leitura on public.relatorio_anotacoes for select to authenticated
 using(consulta_regioes_private.usuario_pode_acessar_relatorio_rota(usuario_id,rota_id)
 and exists(select 1 from public.relatorios_por_rota r where r.usuario_id=relatorio_anotacoes.usuario_id and r.rota_id=relatorio_anotacoes.rota_id and r.arquivo_path=relatorio_anotacoes.arquivo_path));
create policy anotacoes_criacao on public.relatorio_anotacoes for insert to authenticated
 with check(criado_por=(select auth.uid()) and consulta_regioes_private.usuario_pode_acessar_relatorio_rota(usuario_id,rota_id)
 and exists(select 1 from public.relatorios_por_rota r where r.usuario_id=relatorio_anotacoes.usuario_id and r.rota_id=relatorio_anotacoes.rota_id and r.arquivo_path=relatorio_anotacoes.arquivo_path));
create policy anotacoes_edicao on public.relatorio_anotacoes for update to authenticated
 using(consulta_regioes_private.usuario_pode_acessar_relatorio_rota(usuario_id,rota_id)
 and exists(select 1 from public.relatorios_por_rota r where r.usuario_id=relatorio_anotacoes.usuario_id and r.rota_id=relatorio_anotacoes.rota_id and r.arquivo_path=relatorio_anotacoes.arquivo_path))
 with check(consulta_regioes_private.usuario_pode_acessar_relatorio_rota(usuario_id,rota_id)
 and exists(select 1 from public.relatorios_por_rota r where r.usuario_id=relatorio_anotacoes.usuario_id and r.rota_id=relatorio_anotacoes.rota_id and r.arquivo_path=relatorio_anotacoes.arquivo_path));
create policy anotacoes_remocao on public.relatorio_anotacoes for delete to authenticated
 using(consulta_regioes_private.usuario_pode_acessar_relatorio_rota(usuario_id,rota_id)
 and exists(select 1 from public.relatorios_por_rota r where r.usuario_id=relatorio_anotacoes.usuario_id and r.rota_id=relatorio_anotacoes.rota_id and r.arquivo_path=relatorio_anotacoes.arquivo_path));

-- A trava impede inserir uma marcação no arquivo anterior durante sua substituição.
create function consulta_regioes_private.validar_anotacao_relatorio()
returns trigger language plpgsql security invoker set search_path='' as $$
declare caminho text;
begin
 select r.arquivo_path into caminho from public.relatorios_por_rota r
 where r.usuario_id=new.usuario_id and r.rota_id=new.rota_id for share;
 if caminho is distinct from new.arquivo_path then
  raise exception 'Este PDF foi substituído. Abra o relatório atual antes de anotar.';
 end if;
 new.criado_por:=auth.uid();new.criado_em:=now();return new;
end;
$$;
revoke all on function consulta_regioes_private.validar_anotacao_relatorio() from public,anon,authenticated;
create trigger validar_anotacao_relatorio before insert on public.relatorio_anotacoes
 for each row execute function consulta_regioes_private.validar_anotacao_relatorio();

create function consulta_regioes_private.limpar_anotacoes_pdf_substituido()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.arquivo_path is distinct from old.arquivo_path then
  delete from public.relatorio_anotacoes a where a.usuario_id=old.usuario_id and a.rota_id=old.rota_id and a.arquivo_path=old.arquivo_path;
 end if;
 return new;
end;
$$;
revoke all on function consulta_regioes_private.limpar_anotacoes_pdf_substituido() from public,anon,authenticated;
create trigger limpar_anotacoes_pdf_substituido before update of arquivo_path on public.relatorios_por_rota
 for each row execute function consulta_regioes_private.limpar_anotacoes_pdf_substituido();
