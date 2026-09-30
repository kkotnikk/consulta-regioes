-- Execute no SQL Editor do projeto Consulta Regiões.
-- A configuração inteira é aplicada em uma única transação.
begin;

alter table public.rotas
  add column if not exists retornando_base_em timestamptz,
  add column if not exists retornando_base_por uuid references auth.users(id),
  add column if not exists retornando_base_por_nome text;

alter table public.historico_rotas
  drop constraint historico_rotas_acao_check,
  add constraint historico_rotas_acao_check check (
    acao in ('rota_criada', 'rota_editada', 'retornando_base',
             'retorno_confirmado', 'rota_excluida')
  );

create schema if not exists consulta_regioes_private;
revoke all on schema consulta_regioes_private from public, anon;
grant usage on schema consulta_regioes_private to authenticated;

-- A proteção também se aplica a alterações diretas pela API.
create or replace function consulta_regioes_private.proteger_retornando_base()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
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
      raise exception using errcode = '42501', message = 'Usuário não autenticado.';
    end if;

    select u.nome, u.perfil, u.ativo
      into v_usuario_nome, v_perfil, v_ativo
    from public.usuarios u
    where u.id = v_usuario_id
    for share;

    if not found or v_ativo is distinct from true
       or lower(v_perfil) is distinct from 'operacional' then
      raise exception using errcode = '42501',
        message = 'Somente usuários Operacional ativos podem registrar Retornando à base.';
    end if;

    if coalesce(old.status, 'em_rota') <> 'em_rota' then
      raise exception 'Somente uma rota Em rota pode ser marcada como Retornando à base.';
    end if;

    new.retornando_base_em := v_agora;
    new.retornando_base_por := v_usuario_id;
    new.retornando_base_por_nome := v_usuario_nome;

    insert into public.historico_rotas (
      rota_id, motorista, placa, regiao, ajudante, numero_coletas,
      observacao, acao, usuario_id, usuario_nome, criado_em
    ) values (
      new.id, new.motorista, new.placa, new.regiao, new.ajudante,
      new.numero_coletas, new.observacao, 'retornando_base',
      v_usuario_id, v_usuario_nome, v_agora
    );
  elsif coalesce(new.status, 'em_rota') = 'em_rota' then
    -- Um administrador pode reiniciar a rota pelas permissões já existentes.
    new.retornando_base_em := null;
    new.retornando_base_por := null;
    new.retornando_base_por_nome := null;
  elsif new.retornando_base_em is distinct from old.retornando_base_em
     or new.retornando_base_por is distinct from old.retornando_base_por
     or new.retornando_base_por_nome is distinct from old.retornando_base_por_nome then
    raise exception using errcode = '42501',
      message = 'O nome e o horário do registro de retorno à base não podem ser alterados.';
  end if;

  return new;
end;
$function$;

revoke all on function consulta_regioes_private.proteger_retornando_base()
  from public, anon, authenticated;

drop trigger if exists proteger_retornando_base on public.rotas;
create trigger proteger_retornando_base
before insert or update on public.rotas
for each row execute function consulta_regioes_private.proteger_retornando_base();

-- A função privada executa apenas a transição autorizada; não amplia as RLS.
create or replace function consulta_regioes_private.registrar_retornando_base(rota_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_usuario_id uuid := auth.uid();
  v_perfil text;
  v_ativo boolean;
  v_status text;
begin
  if v_usuario_id is null then
    raise exception using errcode = '42501', message = 'Usuário não autenticado.';
  end if;

  select u.perfil, u.ativo into v_perfil, v_ativo
  from public.usuarios u
  where u.id = v_usuario_id
  for share;

  if not found or v_ativo is distinct from true
     or lower(v_perfil) is distinct from 'operacional' then
    raise exception using errcode = '42501',
      message = 'Somente usuários Operacional ativos podem registrar Retornando à base.';
  end if;

  select r.status into v_status
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
$function$;

revoke all on function consulta_regioes_private.registrar_retornando_base(bigint)
  from public, anon, authenticated;
grant execute on function consulta_regioes_private.registrar_retornando_base(bigint)
  to authenticated;

-- Este é o único ponto novo de entrada exposto pela API do site.
create or replace function public.registrar_retornando_base(rota_id bigint)
returns void
language sql
security invoker
set search_path = ''
as $function$
  select consulta_regioes_private.registrar_retornando_base($1);
$function$;

revoke all on function public.registrar_retornando_base(bigint)
  from public, anon, authenticated;
grant execute on function public.registrar_retornando_base(bigint)
  to authenticated;

notify pgrst, 'reload schema';
commit;

-- O resultado deve mostrar todos os itens como true.
select
  (select count(*) = 3 from information_schema.columns
   where table_schema = 'public' and table_name = 'rotas'
     and column_name in ('retornando_base_em', 'retornando_base_por',
                         'retornando_base_por_nome')) as campos_criados,
  to_regprocedure('public.registrar_retornando_base(bigint)') is not null as funcao_criada,
  exists (select 1 from pg_trigger where tgrelid = 'public.rotas'::regclass
          and tgname = 'proteger_retornando_base' and tgenabled = 'O') as protecao_ativa,
  has_function_privilege('authenticated', 'public.registrar_retornando_base(bigint)',
                         'execute') as usuarios_autenticados,
  not has_function_privilege('anon', 'public.registrar_retornando_base(bigint)',
                             'execute') as anonimo_bloqueado,
  exists (select 1 from pg_constraint where conrelid = 'public.historico_rotas'::regclass
          and conname = 'historico_rotas_acao_check'
          and pg_get_constraintdef(oid) like '%retornando_base%') as historico_atualizado;
