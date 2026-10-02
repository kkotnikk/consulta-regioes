-- Operadores Coleta e Administradores enviam PDFs de uma rota para todos os
-- usuários ativos vinculados. A seleção de destinatários é refeita no banco.
create or replace function consulta_regioes_private.usuario_pode_distribuir_pdf(caminho text)
returns boolean language sql stable security definer set search_path='' as $$
 select case when caminho ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{1,18}/[0-9a-f-]{36}\.pdf$'
 then (select consulta_regioes_private.usuario_tem_permissao(array['operador_coleta']::text[]))
 and exists(select 1 from public.rotas r where r.id=split_part(caminho,'/',2)::bigint)
 and exists(select 1 from public.usuarios u where u.id=split_part(caminho,'/',1)::uuid
  and u.ativo=true and u.perfil in ('admin','operador_coleta')
  and split_part(caminho,'/',2)::bigint=any(u.rotas_coleta_ids))
 else false end;
$$;
revoke all on function consulta_regioes_private.usuario_pode_distribuir_pdf(text) from public,anon;
grant execute on function consulta_regioes_private.usuario_pode_distribuir_pdf(text) to authenticated;

-- A verificação de vínculo precisa enxergar todas as linhas, inclusive as
-- que o remetente não pode ler pela RLS de relatórios.
create function consulta_regioes_private.pdf_lote_sem_vinculo(caminho text)
returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.relatorios_por_rota r where r.arquivo_path=caminho);
$$;
revoke all on function consulta_regioes_private.pdf_lote_sem_vinculo(text) from public,anon;
grant execute on function consulta_regioes_private.pdf_lote_sem_vinculo(text) to authenticated;

create policy relatorio_lote_pdf_envio on storage.objects for insert to authenticated
 with check(bucket_id='relatorios' and owner_id=(select auth.uid())::text
 and consulta_regioes_private.usuario_pode_distribuir_pdf(name));
-- O autor pode limpar apenas arquivos de lote ainda não vinculados.
create policy relatorio_lote_pdf_limpeza_leitura on storage.objects for select to authenticated
 using(bucket_id='relatorios' and owner_id=(select auth.uid())::text
 and consulta_regioes_private.usuario_pode_distribuir_pdf(name)
 and consulta_regioes_private.pdf_lote_sem_vinculo(name));
create policy relatorio_lote_pdf_limpeza on storage.objects for delete to authenticated
 using(bucket_id='relatorios' and owner_id=(select auth.uid())::text
 and consulta_regioes_private.usuario_pode_distribuir_pdf(name)
 and consulta_regioes_private.pdf_lote_sem_vinculo(name));

create function consulta_regioes_private.destinatarios_relatorios_em_lote()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not (select consulta_regioes_private.usuario_tem_permissao(array['operador_coleta']::text[])) then
  raise exception using errcode='42501',message='Sem permissão para distribuir relatórios.';
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'nome',u.nome,'rotas_coleta_ids',u.rotas_coleta_ids) order by u.nome,u.id)
  from public.usuarios u where u.ativo=true and u.perfil in ('admin','operador_coleta') and cardinality(u.rotas_coleta_ids)>0),'[]'::jsonb);
end;
$$;
revoke all on function consulta_regioes_private.destinatarios_relatorios_em_lote() from public,anon,authenticated;
grant execute on function consulta_regioes_private.destinatarios_relatorios_em_lote() to authenticated;
create function public.destinatarios_relatorios_em_lote()
returns jsonb language sql security invoker set search_path='' as $$
 select consulta_regioes_private.destinatarios_relatorios_em_lote();
$$;
revoke all on function public.destinatarios_relatorios_em_lote() from public,anon,authenticated;
grant execute on function public.destinatarios_relatorios_em_lote() to authenticated;

create function consulta_regioes_private.distribuir_relatorio_rota(
 p_rota_id bigint,p_nome text,p_arquivos jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 usuario uuid:=auth.uid();
 destino record;
 caminho text;
 esperados integer;
 recebidos jsonb:='[]'::jsonb;
 ultimo_usuario uuid;
begin
 if usuario is null or not (select consulta_regioes_private.usuario_tem_permissao(array['operador_coleta']::text[])) then
  raise exception using errcode='42501',message='Sem permissão para distribuir relatórios.';
 end if;
 if p_nome is null or length(btrim(p_nome)) not between 1 and 255 or p_arquivos is null or jsonb_typeof(p_arquivos)<>'array' then
  raise exception 'Seleção de PDFs inválida.';
 end if;
 perform 1 from public.rotas r where r.id=p_rota_id for update;
 if not found then raise exception 'Rota não encontrada.';end if;
 perform 1 from public.usuarios u where u.ativo=true and u.perfil in ('admin','operador_coleta')
  and p_rota_id=any(u.rotas_coleta_ids) for share;
 select count(*) into esperados from public.usuarios u where u.ativo=true and u.perfil in ('admin','operador_coleta')
  and p_rota_id=any(u.rotas_coleta_ids);
 if esperados=0 or jsonb_array_length(p_arquivos)<>esperados then
  raise exception 'Os destinatários da rota mudaram. Atualize a prévia e tente novamente.';
 end if;
 for destino in select u.id,u.nome from public.usuarios u where u.ativo=true and u.perfil in ('admin','operador_coleta')
  and p_rota_id=any(u.rotas_coleta_ids) order by u.id loop
  select item->>'arquivo_path' into caminho from jsonb_array_elements(p_arquivos) item
   where item->>'usuario_id'=destino.id::text;
  if caminho is null or caminho !~ '^[0-9a-f-]{36}/[0-9]{1,18}/[0-9a-f-]{36}\.pdf$'
   or split_part(caminho,'/',1)<>destino.id::text or split_part(caminho,'/',2)<>p_rota_id::text
   or not exists(select 1 from storage.objects o where o.bucket_id='relatorios' and o.name=caminho
    and o.owner_id=usuario::text and o.metadata->>'mimetype'='application/pdf') then
   raise exception 'PDF de um destinatário ausente ou inválido.';
  end if;
  insert into public.relatorios_por_rota(usuario_id,rota_id,arquivo_path,nome,enviado_por)
   values(destino.id,p_rota_id,caminho,p_nome,usuario)
   on conflict(usuario_id,rota_id) do update set arquivo_path=excluded.arquivo_path,nome=excluded.nome,enviado_por=usuario;
  recebidos:=recebidos||jsonb_build_array(jsonb_build_object('id',destino.id,'nome',destino.nome));
  ultimo_usuario:=destino.id;
 end loop;
 return jsonb_build_object('rota_id',p_rota_id,'destinatarios',recebidos,'usuario_total_id',ultimo_usuario);
end;
$$;
revoke all on function consulta_regioes_private.distribuir_relatorio_rota(bigint,text,jsonb) from public,anon,authenticated;
grant execute on function consulta_regioes_private.distribuir_relatorio_rota(bigint,text,jsonb) to authenticated;
create function public.distribuir_relatorio_rota(p_rota_id bigint,p_nome text,p_arquivos jsonb)
returns jsonb language sql security invoker set search_path='' as $$
 select consulta_regioes_private.distribuir_relatorio_rota($1,$2,$3);
$$;
revoke all on function public.distribuir_relatorio_rota(bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.distribuir_relatorio_rota(bigint,text,jsonb) to authenticated;

-- Permite a quem enviou o lote registrar o total do rodapé do PDF recém
-- vinculado, sem permitir que leia ou edite as anotações dos destinatários.
create or replace function consulta_regioes_private.registrar_total_coletas_pdf(
 p_usuario_id uuid,p_rota_id bigint,p_arquivo_path text,p_total integer,p_origem text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 usuario uuid:=auth.uid();
 caminho text;
 ultimo_usuario uuid;
 ultimo_caminho text;
 quantidade integer;
 total_anterior integer;
 caminho_anterior text;
begin
 if usuario is null then raise exception using errcode='42501',message='Usuário não autenticado.';end if;
 perform 1 from public.usuarios u where u.id=usuario and u.ativo=true for share;
 if not found or not (
  consulta_regioes_private.usuario_pode_acessar_relatorio_rota(p_usuario_id,p_rota_id)
  or ((select consulta_regioes_private.usuario_tem_permissao(array['operador_coleta']::text[]))
   and exists(select 1 from storage.objects o where o.bucket_id='relatorios' and o.name=p_arquivo_path
    and o.owner_id=usuario::text))
 ) then raise exception using errcode='42501',message='Sem permissão para atualizar o total deste relatório.';end if;
 if p_total is null or p_total<0 or p_total>1000000 or p_origem is null or p_origem not in ('texto','ocr') then
  raise exception 'Total de coletas inválido.';
 end if;
 select r.numero_coletas into quantidade from public.rotas r where r.id=p_rota_id for update;
 if not found then raise exception 'Rota não encontrada.';end if;
 perform 1 from public.relatorios_por_rota r where r.rota_id=p_rota_id order by r.usuario_id for update;
 select r.arquivo_path into caminho from public.relatorios_por_rota r where r.usuario_id=p_usuario_id and r.rota_id=p_rota_id;
 if caminho is distinct from p_arquivo_path or p_arquivo_path is null then
  raise exception 'Este PDF foi substituído. Leia o rodapé do arquivo atual.';
 end if;
 select t.arquivo_path,t.total into caminho_anterior,total_anterior
 from consulta_regioes_private.relatorios_totais t where t.usuario_id=p_usuario_id and t.rota_id=p_rota_id;
 select r.usuario_id,r.arquivo_path into ultimo_usuario,ultimo_caminho from public.relatorios_por_rota r
 where r.rota_id=p_rota_id order by r.atualizado_em desc,r.usuario_id desc limit 1;
 if ultimo_usuario=p_usuario_id and ultimo_caminho=p_arquivo_path
  and caminho_anterior=p_arquivo_path and total_anterior=p_total and quantidade is distinct from p_total then
  return jsonb_build_object('aplicado',false,'preservado_manual',true,'total',p_total,'numero_coletas',quantidade,'rota_id',p_rota_id);
 end if;
 insert into consulta_regioes_private.relatorios_totais(usuario_id,rota_id,arquivo_path,total,origem,lido_por,lido_em)
 values(p_usuario_id,p_rota_id,p_arquivo_path,p_total,p_origem,usuario,now())
 on conflict(usuario_id,rota_id) do update set arquivo_path=excluded.arquivo_path,total=excluded.total,origem=excluded.origem,lido_por=excluded.lido_por,lido_em=excluded.lido_em;
 if ultimo_usuario=p_usuario_id and ultimo_caminho=p_arquivo_path then
  if quantidade is distinct from p_total then update public.rotas set numero_coletas=p_total where id=p_rota_id;end if;
  return jsonb_build_object('aplicado',true,'total',p_total,'numero_coletas',p_total,'rota_id',p_rota_id);
 end if;
 return jsonb_build_object('aplicado',false,'total',p_total,'numero_coletas',quantidade,'rota_id',p_rota_id);
end;
$$;
notify pgrst,'reload schema';
