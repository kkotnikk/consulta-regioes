create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema consulta_regioes_private;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth,public,consulta_regioes_private to anon,authenticated,service_role;
create table public.usuarios(id uuid primary key references auth.users(id),nome text not null,perfil text not null,ativo boolean not null,criado_em timestamptz default now(),constraint usuarios_perfil_check check(perfil in ('admin','operacional')));
create table public.rotas(id bigint primary key, motorista text,placa text,regiao text,ajudante text,observacao text,status text default 'em_rota',retorno_confirmado_em timestamptz,retorno_confirmado_por uuid,retorno_confirmado_por_nome text,retornando_base_em timestamptz,retornando_base_por uuid,retornando_base_por_nome text,numero_coletas integer);
create table public.historico_rotas(id bigint generated always as identity primary key,rota_id bigint,motorista text,placa text,regiao text,ajudante text,numero_coletas integer,observacao text,acao text,usuario_id uuid,usuario_nome text,criado_em timestamptz);
create table public.bairros(id bigint primary key,bairro text,regiao text);
create table public.sugestoes(id bigint primary key);
create table public.suporte_chamados(id bigint primary key);
grant all on all tables in schema public to authenticated,service_role;
grant select on public.rotas,public.bairros to anon;
grant insert on public.sugestoes,public.suporte_chamados to anon;
grant usage on all sequences in schema public to authenticated,service_role;
insert into auth.users values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-000000000003'),('00000000-0000-0000-0000-000000000004');
insert into public.usuarios(id,nome,perfil,ativo) values('00000000-0000-0000-0000-000000000001','João','admin',true),('00000000-0000-0000-0000-000000000002','Legado','operacional',true);
insert into public.rotas(id,motorista,placa,regiao) select n,'Motorista '||n,'ABC1234','Lapa' from generate_series(1,8)n;
CREATE OR REPLACE FUNCTION public.confirmar_retorno_rota(rota_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
      and ativo = true;

    if not found then
        raise exception 'Usuário sem acesso ao sistema.';
    end if;

    if not consulta_regioes_private.usuario_tem_permissao(array['operacional']::text[]) then
        raise exception 'Somente usuários Operacional ou Administrativo ativos podem confirmar retorno.';
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
CREATE OR REPLACE FUNCTION consulta_regioes_private.usuario_tem_permissao(perfis_permitidos text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.usuarios u
    where u.id = auth.uid()
      and u.ativo is true
      and (lower(u.perfil) = 'admin' or lower(u.perfil) = any(perfis_permitidos))
  );
$function$
;
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
      or not consulta_regioes_private.usuario_tem_permissao(array['operacional']::text[]) then
      raise exception using errcode = '42501',
        message = 'Somente usuários Operacional ou Administrativo ativos podem confirmar retorno.';
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
       or not consulta_regioes_private.usuario_tem_permissao(array['operacional']::text[]) then

      raise exception using
        errcode = '42501',
        message = 'Somente usuários Operacional ou Administrativo ativos podem registrar Retornando à base.';
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
     or not consulta_regioes_private.usuario_tem_permissao(array['operacional']::text[]) then

    raise exception using
      errcode = '42501',
      message = 'Somente usuários Operacional ou Administrativo ativos podem registrar Retornando à base.';
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
create function public.registrar_retornando_base(rota_id bigint) returns void language sql security invoker set search_path='' as $$select consulta_regioes_private.registrar_retornando_base(rota_id);$$;
create trigger proteger_confirmacao_retorno before insert or update on public.rotas for each row execute function consulta_regioes_private.proteger_confirmacao_retorno();
create trigger proteger_retornando_base before insert or update on public.rotas for each row execute function consulta_regioes_private.proteger_retornando_base();

