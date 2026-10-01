-- Coleta: de uma até três rotas; Administrador: zero até três rotas de referência.
-- O Administrador mantém todas as permissões, inclusive nas demais rotas.
alter table public.usuarios drop constraint if exists usuarios_rotas_coleta_check;
alter table public.usuarios add constraint usuarios_rotas_coleta_check check (
 ((perfil='operador_coleta' and (cardinality(rotas_coleta_ids) between 1 and 3 or (not ativo and cardinality(rotas_coleta_ids)=0)))
  or (perfil='admin' and cardinality(rotas_coleta_ids) between 0 and 3)
  or (perfil='operador_conferencia' and cardinality(rotas_coleta_ids)=0))
 and (cardinality(rotas_coleta_ids)=0 or (
   array_ndims(rotas_coleta_ids)=1 and array_lower(rotas_coleta_ids,1)=1
   and array_position(rotas_coleta_ids,null) is null
   and (cardinality(rotas_coleta_ids)<2 or rotas_coleta_ids[1]<>rotas_coleta_ids[2])
   and (cardinality(rotas_coleta_ids)<3 or (rotas_coleta_ids[1]<>rotas_coleta_ids[3] and rotas_coleta_ids[2]<>rotas_coleta_ids[3]))
 ))
);
create or replace function consulta_regioes_private.validar_usuario()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and old.id=auth.uid() and old.perfil='admin'
 and (new.perfil <> 'admin' or not new.ativo) then
   raise exception 'Você não pode remover seu próprio acesso de administrador.';
 end if;
 if new.id is distinct from old.id and tg_op='UPDATE' then raise exception 'O identificador do usuário não pode ser alterado.'; end if;
 if btrim(new.nome)='' then raise exception 'Informe o nome de quem vai usar esta conta.'; end if;
 if (new.perfil='operador_coleta' and (cardinality(new.rotas_coleta_ids)>3 or (new.ativo and cardinality(new.rotas_coleta_ids)<1)))
 or (new.perfil='admin' and cardinality(new.rotas_coleta_ids)>3)
 or (new.perfil='operador_conferencia' and cardinality(new.rotas_coleta_ids)>0) then
   raise exception 'Limite de rotas: Coleta de uma até três; Administrador até três; Conferência sem vínculo.';
 end if;
 perform 1 from public.rotas r where r.id=any(new.rotas_coleta_ids) for key share;
 if cardinality(new.rotas_coleta_ids)>0 and
 (select count(*) from public.rotas r where r.id=any(new.rotas_coleta_ids))<>cardinality(new.rotas_coleta_ids) then
   raise exception 'Selecione somente rotas existentes e diferentes.';
 end if;
 return new;
end;
$$;
revoke all on function consulta_regioes_private.validar_usuario() from public, anon, authenticated;
create or replace function consulta_regioes_private.proteger_rota_atribuida()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.usuarios u where old.id=any(u.rotas_coleta_ids)) then
   raise exception 'Esta rota está vinculada a um usuário. Desvincule a rota no cadastro do usuário antes de excluir.';
 end if;
 return old;
end;
$$;
revoke all on function consulta_regioes_private.proteger_rota_atribuida() from public, anon, authenticated;

