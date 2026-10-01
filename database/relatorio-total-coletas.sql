-- A leitura do PDF pode atualizar somente o número de coletas da sua rota.
-- O registro interno preserva origem, arquivo e autor sem publicar documentos.
create table consulta_regioes_private.relatorios_totais (
 usuario_id uuid not null,
 rota_id bigint not null,
 arquivo_path text not null,
 total integer not null check(total between 0 and 1000000),
 origem text not null check(origem in ('texto','ocr')),
 lido_por uuid not null references auth.users(id),
 lido_em timestamptz not null default now(),
 primary key(usuario_id,rota_id),
 foreign key(usuario_id,rota_id) references public.relatorios_por_rota(usuario_id,rota_id) on delete cascade
);
create index relatorios_totais_autor_idx on consulta_regioes_private.relatorios_totais(lido_por);
alter table consulta_regioes_private.relatorios_totais enable row level security;
revoke all on consulta_regioes_private.relatorios_totais from public,anon,authenticated;
create policy totais_relatorio_leitura on consulta_regioes_private.relatorios_totais for select to authenticated
 using(consulta_regioes_private.usuario_pode_acessar_relatorio_rota(usuario_id,rota_id));

-- SECURITY DEFINER é restrito a esta operação e ao schema privado: o Operador
-- Coleta continua sem UPDATE direto de rotas ou de outros campos cadastrais.
create function consulta_regioes_private.registrar_total_coletas_pdf(
 p_usuario_id uuid,p_rota_id bigint,p_arquivo_path text,p_total integer,p_origem text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 usuario uuid:=auth.uid();
 caminho text;
 ultimo_usuario uuid;
 ultimo_caminho text;
 quantidade integer;
begin
 if usuario is null then raise exception using errcode='42501',message='Usuário não autenticado.';end if;
 perform 1 from public.usuarios u where u.id=usuario and u.ativo=true for share;
 if not found or not consulta_regioes_private.usuario_pode_acessar_relatorio_rota(p_usuario_id,p_rota_id) then
  raise exception using errcode='42501',message='Sem permissão para atualizar o total deste relatório.';
 end if;
 if p_total is null or p_total<0 or p_total>1000000 or p_origem is null or p_origem not in ('texto','ocr') then
  raise exception 'Total de coletas inválido.';
 end if;
 select r.numero_coletas into quantidade from public.rotas r where r.id=p_rota_id for update;
 if not found then raise exception 'Rota não encontrada.';end if;
 -- Serialize substituições dos PDFs existentes e impeça inserções concorrentes
 -- pela trava da rota referenciada, antes de decidir qual arquivo é o mais novo.
 perform 1 from public.relatorios_por_rota r where r.rota_id=p_rota_id order by r.usuario_id for update;
 select r.arquivo_path into caminho from public.relatorios_por_rota r where r.usuario_id=p_usuario_id and r.rota_id=p_rota_id;
 if caminho is distinct from p_arquivo_path or p_arquivo_path is null then
  raise exception 'Este PDF foi substituído. Leia o rodapé do arquivo atual.';
 end if;
 insert into consulta_regioes_private.relatorios_totais(usuario_id,rota_id,arquivo_path,total,origem,lido_por,lido_em)
 values(p_usuario_id,p_rota_id,p_arquivo_path,p_total,p_origem,usuario,now())
 on conflict(usuario_id,rota_id) do update set arquivo_path=excluded.arquivo_path,total=excluded.total,origem=excluded.origem,lido_por=excluded.lido_por,lido_em=excluded.lido_em;
 select r.usuario_id,r.arquivo_path into ultimo_usuario,ultimo_caminho from public.relatorios_por_rota r
 where r.rota_id=p_rota_id order by r.atualizado_em desc,r.usuario_id desc limit 1;
 if ultimo_usuario=p_usuario_id and ultimo_caminho=p_arquivo_path then
  if quantidade is distinct from p_total then update public.rotas set numero_coletas=p_total where id=p_rota_id;end if;
  return jsonb_build_object('aplicado',true,'total',p_total,'numero_coletas',p_total,'rota_id',p_rota_id);
 end if;
 return jsonb_build_object('aplicado',false,'total',p_total,'numero_coletas',quantidade,'rota_id',p_rota_id);
end;
$$;
revoke all on function consulta_regioes_private.registrar_total_coletas_pdf(uuid,bigint,text,integer,text) from public,anon,authenticated;
grant execute on function consulta_regioes_private.registrar_total_coletas_pdf(uuid,bigint,text,integer,text) to authenticated;
create function public.registrar_total_coletas_pdf(p_usuario_id uuid,p_rota_id bigint,p_arquivo_path text,p_total integer,p_origem text)
returns jsonb language sql security invoker set search_path='' as $$
 select consulta_regioes_private.registrar_total_coletas_pdf($1,$2,$3,$4,$5);
$$;
revoke all on function public.registrar_total_coletas_pdf(uuid,bigint,text,integer,text) from public,anon,authenticated;
grant execute on function public.registrar_total_coletas_pdf(uuid,bigint,text,integer,text) to authenticated;
notify pgrst,'reload schema';
