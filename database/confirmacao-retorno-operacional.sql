-- Confirmação de chegada exclusiva do perfil Operacional ativo.
begin;

-- Preserva a implementação e a auditoria da RPC existente.
do $update$
declare
  v_sql text := pg_get_functiondef('public.confirmar_retorno_rota(bigint)'::regprocedure);
  v_antiga text := 'v_perfil not in (''admin'', ''operacional'')';
  v_nova text := 'lower(v_perfil) is distinct from ''operacional''';
begin
  if strpos(v_sql, v_antiga) = 0 and strpos(v_sql, v_nova) = 0 then
    raise exception 'A função confirmar_retorno_rota está diferente da versão esperada.';
  end if;
  v_sql := replace(v_sql, v_antiga, v_nova);
  v_sql := replace(v_sql, 'Usuário sem permissão para confirmar retorno.',
    'Somente usuários Operacional ativos podem confirmar retorno.');
  execute v_sql;
end;
$update$;

revoke all on function public.confirmar_retorno_rota(bigint) from public, anon;
grant execute on function public.confirmar_retorno_rota(bigint) to authenticated;

-- Impede contornar a RPC alterando a tabela diretamente.
create or replace function consulta_regioes_private.proteger_confirmacao_retorno()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
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
      or lower(v_perfil) is distinct from 'operacional' then
      raise exception using errcode = '42501',
        message = 'Somente usuários Operacional ativos podem confirmar retorno.';
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function consulta_regioes_private.proteger_confirmacao_retorno()
  from public, anon, authenticated;
drop trigger if exists proteger_confirmacao_retorno on public.rotas;
create trigger proteger_confirmacao_retorno
before insert or update on public.rotas
for each row execute function consulta_regioes_private.proteger_confirmacao_retorno();

notify pgrst, 'reload schema';
commit;
