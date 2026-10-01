-- Perfis individuais e autorização central; executar uma vez via migration.
alter table public.usuarios drop constraint if exists usuarios_perfil_check;
alter table public.usuarios alter column perfil drop default;
alter table public.usuarios add column if not exists rotas_coleta_ids bigint[] not null default '{}';
-- Contas legadas precisam de nome individual e duas rotas antes de voltar a operar.
update public.usuarios set perfil='operador_coleta', ativo=false where perfil='operacional';
alter table public.usuarios add constraint usuarios_perfil_check check (perfil in ('admin','operador_coleta','operador_conferencia'));
alter table public.usuarios add constraint usuarios_rotas_coleta_check check (
 (perfil <> 'operador_coleta' and cardinality(rotas_coleta_ids)=0)
 or (perfil='operador_coleta' and (
   (not ativo and cardinality(rotas_coleta_ids)=0)
   or (cardinality(rotas_coleta_ids)=2 and rotas_coleta_ids[1] is not null and rotas_coleta_ids[2] is not null and rotas_coleta_ids[1]<>rotas_coleta_ids[2])
 ))
);
create or replace function consulta_regioes_private.usuario_pode_retornar_rota(rota_id bigint)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.usuarios u where u.id=auth.uid() and u.ativo
 and (u.perfil='admin' or (u.perfil='operador_coleta' and rota_id=any(u.rotas_coleta_ids))));
$$;
revoke all on function consulta_regioes_private.usuario_pode_retornar_rota(bigint) from public, anon;
grant execute on function consulta_regioes_private.usuario_pode_retornar_rota(bigint) to authenticated;

create or replace function consulta_regioes_private.validar_usuario()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and old.id=auth.uid() and old.perfil='admin'
 and (new.perfil <> 'admin' or not new.ativo) then
   raise exception 'Você não pode remover seu próprio acesso de administrador.';
 end if;
 if new.id is distinct from old.id and tg_op='UPDATE' then raise exception 'O identificador do usuário não pode ser alterado.'; end if;
 if btrim(new.nome)='' then raise exception 'Informe o nome de quem vai usar esta conta.'; end if;
 perform 1 from public.rotas r where r.id=any(new.rotas_coleta_ids) for key share;
 if cardinality(new.rotas_coleta_ids)>0 and
 (select count(*) from public.rotas r where r.id=any(new.rotas_coleta_ids))<>2 then
   raise exception 'Selecione duas rotas existentes e diferentes.';
 end if;
 return new;
end;
$$;
revoke all on function consulta_regioes_private.validar_usuario() from public, anon, authenticated;
create trigger validar_usuario before insert or update on public.usuarios
for each row execute function consulta_regioes_private.validar_usuario();
create or replace function consulta_regioes_private.proteger_rota_atribuida()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.usuarios u where old.id=any(u.rotas_coleta_ids)) then
   raise exception 'Esta rota está atribuída a um Operador Coleta. Altere as duas rotas do usuário antes de excluir.';
 end if;
 return old;
end;
$$;
revoke all on function consulta_regioes_private.proteger_rota_atribuida() from public, anon, authenticated;
create trigger proteger_rota_atribuida before delete on public.rotas
for each row execute function consulta_regioes_private.proteger_rota_atribuida();
CREATE OR REPLACE FUNCTION consulta_regioes_private.proteger_confirmacao_retorno()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_proteger boolean;
  v_perfil text;
  v_ativo boolean;
begin
  if tg_op = 'INSERT' then
    v_proteger := new.status = 'retorno_confirmado'
      or new.retorno_confirmado_em is not null
      or new.retorno_confirmado_por is not null
      or new.retorno_confirmado_por_nome is not null;
  else
    v_proteger := (new.status = 'retorno_confirmado' and old.status is distinct from 'retorno_confirmado')
      or ((new.retorno_confirmado_em is distinct from old.retorno_confirmado_em
        or new.retorno_confirmado_por is distinct from old.retorno_confirmado_por
        or new.retorno_confirmado_por_nome is distinct from old.retorno_confirmado_por_nome)
        and (new.status = 'retorno_confirmado'
          or new.retorno_confirmado_em is not null
          or new.retorno_confirmado_por is not null
          or new.retorno_confirmado_por_nome is not null));
  end if;

  if coalesce(v_proteger, false) then
    select u.perfil, u.ativo into v_perfil, v_ativo
    from public.usuarios u where u.id = auth.uid() for share;

    if not found or v_ativo is distinct from true
      or not consulta_regioes_private.usuario_tem_permissao(array['operador_conferencia']::text[]) then
      raise exception using errcode = '42501',
        message = 'Somente Operador Conferência ou Administrador ativos podem confirmar retorno.';
    end if;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION consulta_regioes_private.proteger_retornando_base()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_usuario_id uuid := auth.uid();
  v_usuario_nome text;
  v_perfil text;
  v_ativo boolean;
  v_agora timestamptz := now();
begin
  if tg_op = 'INSERT' then
    if new.status = 'retornando_base' then
      raise exception 'Crie a rota como Em rota antes de registrar o retorno à base.';
    end if;

    new.retornando_base_em := null;
    new.retornando_base_por := null;
    new.retornando_base_por_nome := null;

    return new;
  end if;

  if new.status = 'retornando_base'
     and old.status is distinct from 'retornando_base' then

    if v_usuario_id is null then
      raise exception using
        errcode = '42501',
        message = 'Usuário não autenticado.';
    end if;

    select u.nome, u.perfil, u.ativo
      into v_usuario_nome, v_perfil, v_ativo
    from public.usuarios u
    where u.id = v_usuario_id
    for share;

    if not found
       or v_ativo is distinct from true
       or not consulta_regioes_private.usuario_pode_retornar_rota(new.id) then

      raise exception using
        errcode = '42501',
        message = 'Somente o Operador Coleta atribuído a esta rota ou o Administrador podem registrar Retornando à base.';
    end if;

    if coalesce(old.status, 'em_rota') <> 'em_rota' then
      raise exception 'Somente uma rota Em rota pode ser marcada como Retornando à base.';
    end if;

    new.retornando_base_em := v_agora;
    new.retornando_base_por := v_usuario_id;
    new.retornando_base_por_nome := v_usuario_nome;

    insert into public.historico_rotas (
      rota_id,
      motorista,
      placa,
      regiao,
      ajudante,
      numero_coletas,
      observacao,
      acao,
      usuario_id,
      usuario_nome,
      criado_em
    )
    values (
      new.id,
      new.motorista,
      new.placa,
      new.regiao,
      new.ajudante,
      new.numero_coletas,
      new.observacao,
      'retornando_base',
      v_usuario_id,
      v_usuario_nome,
      v_agora
    );

  elsif coalesce(new.status, 'em_rota') = 'em_rota' then
    new.retornando_base_em := null;
    new.retornando_base_por := null;
    new.retornando_base_por_nome := null;

  elsif new.retornando_base_em is distinct from old.retornando_base_em
     or new.retornando_base_por is distinct from old.retornando_base_por
     or new.retornando_base_por_nome is distinct from old.retornando_base_por_nome then

    raise exception using
      errcode = '42501',
      message = 'O nome e o horário do registro de retorno à base não podem ser alterados.';
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION consulta_regioes_private.registrar_retornando_base(rota_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_usuario_id uuid := auth.uid();
  v_perfil text;
  v_ativo boolean;
  v_status text;
begin
  if v_usuario_id is null then
    raise exception using
      errcode = '42501',
      message = 'Usuário não autenticado.';
  end if;

  select u.perfil, u.ativo
    into v_perfil, v_ativo
  from public.usuarios u
  where u.id = v_usuario_id
  for share;

  if not found
     or v_ativo is distinct from true
     or not consulta_regioes_private.usuario_pode_retornar_rota(rota_id) then

    raise exception using
      errcode = '42501',
      message = 'Somente o Operador Coleta atribuído a esta rota ou o Administrador podem registrar Retornando à base.';
  end if;

  select r.status
    into v_status
  from public.rotas r
  where r.id = rota_id
  for update;

  if not found then
    raise exception 'Rota não encontrada.';
  end if;

  if coalesce(v_status, 'em_rota') <> 'em_rota' then
    raise exception 'Esta rota já saiu do status Em rota. Atualize o acompanhamento.';
  end if;

  update public.rotas r
  set status = 'retornando_base'
  where r.id = rota_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION consulta_regioes_private.confirmar_retorno_rota(rota_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_usuario_id uuid;
    v_usuario_nome text;
    v_perfil text;
    v_rota public.rotas%rowtype;
    v_agora timestamptz := now();
begin
    v_usuario_id := auth.uid();

    if v_usuario_id is null then
        raise exception 'Usuário não autenticado.';
    end if;

    select nome, perfil
    into v_usuario_nome, v_perfil
    from public.usuarios
    where id = v_usuario_id
      and ativo = true for share;

    if not found then
        raise exception 'Usuário sem acesso ao sistema.';
    end if;

    if not consulta_regioes_private.usuario_tem_permissao(array['operador_conferencia']::text[]) then
        raise exception 'Somente Operador Conferência ou Administrador ativos podem confirmar retorno.';
    end if;

    select *
    into v_rota
    from public.rotas
    where id = rota_id
    for update;

    if not found then
        raise exception 'Rota não encontrada.';
    end if;

    if v_rota.status = 'retorno_confirmado' then
        raise exception 'O retorno desta rota já foi confirmado.';
    end if;

    update public.rotas
    set
        status = 'retorno_confirmado',
        retorno_confirmado_em = v_agora,
        retorno_confirmado_por = v_usuario_id,
        retorno_confirmado_por_nome = v_usuario_nome
    where id = rota_id;

    insert into public.historico_rotas (
        rota_id,
        motorista,
        placa,
        regiao,
        ajudante,
        numero_coletas,
        observacao,
        acao,
        usuario_id,
        usuario_nome,
        criado_em
    )
    values (
        v_rota.id,
        v_rota.motorista,
        v_rota.placa,
        v_rota.regiao,
        v_rota.ajudante,
        v_rota.numero_coletas,
        v_rota.observacao,
        'retorno_confirmado',
        v_usuario_id,
        v_usuario_nome,
        v_agora
    );
end;
$function$
;

create or replace function public.confirmar_retorno_rota(rota_id bigint)
returns void language sql security invoker set search_path='' as $$
 select consulta_regioes_private.confirmar_retorno_rota(rota_id);
$$;
revoke all on function public.confirmar_retorno_rota(bigint) from public, anon;
revoke all on function consulta_regioes_private.confirmar_retorno_rota(bigint) from public, anon;
grant execute on function public.confirmar_retorno_rota(bigint), consulta_regioes_private.confirmar_retorno_rota(bigint) to authenticated;
-- Remove permissive legacy policies that allowed every logged-in user to administer data.
do $$
declare p record;
begin
 for p in select * from pg_policies where schemaname='public'
 and tablename in ('usuarios','rotas','bairros','sugestoes','suporte_chamados','historico_rotas') loop
 execute format('drop policy %I on public.%I',p.policyname,p.tablename);
 end loop;
end;
$$;
alter table public.usuarios enable row level security;
alter table public.rotas enable row level security;
alter table public.bairros enable row level security;
alter table public.sugestoes enable row level security;
alter table public.suporte_chamados enable row level security;
alter table public.historico_rotas enable row level security;
create policy usuarios_leitura on public.usuarios for select to authenticated
 using(id=(select auth.uid()) or (select consulta_regioes_private.usuario_tem_permissao('{}'::text[])));
create policy usuarios_admin_edita on public.usuarios for update to authenticated
 using((select consulta_regioes_private.usuario_tem_permissao('{}'::text[])))
 with check((select consulta_regioes_private.usuario_tem_permissao('{}'::text[])));
grant select, update on public.usuarios to authenticated;
create policy rotas_leitura on public.rotas for select to authenticated
 using((select consulta_regioes_private.usuario_tem_permissao(array['operador_coleta','operador_conferencia']::text[])));
create policy rotas_admin on public.rotas for all to authenticated
 using((select consulta_regioes_private.usuario_tem_permissao('{}'::text[])))
 with check((select consulta_regioes_private.usuario_tem_permissao('{}'::text[])));
create policy bairros_leitura on public.bairros for select to anon,authenticated using(true);
create policy bairros_admin on public.bairros for all to authenticated
 using((select consulta_regioes_private.usuario_tem_permissao('{}'::text[])))
 with check((select consulta_regioes_private.usuario_tem_permissao('{}'::text[])));
create policy sugestoes_envio on public.sugestoes for insert to anon,authenticated with check(true);
create policy sugestoes_admin on public.sugestoes for all to authenticated
 using((select consulta_regioes_private.usuario_tem_permissao('{}'::text[])))
 with check((select consulta_regioes_private.usuario_tem_permissao('{}'::text[])));
create policy suporte_envio on public.suporte_chamados for insert to anon,authenticated with check(true);
create policy suporte_admin on public.suporte_chamados for all to authenticated
 using((select consulta_regioes_private.usuario_tem_permissao('{}'::text[])))
 with check((select consulta_regioes_private.usuario_tem_permissao('{}'::text[])));
create policy historico_admin_leitura on public.historico_rotas for select to authenticated
 using((select consulta_regioes_private.usuario_tem_permissao('{}'::text[])));
-- Existing client-side administrative route edits record audit rows.
create policy historico_admin_insere on public.historico_rotas for insert to authenticated
 with check((select consulta_regioes_private.usuario_tem_permissao('{}'::text[])) and usuario_id=(select auth.uid()));
