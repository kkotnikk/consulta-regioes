begin;

-- Regra compartilhada pelas permissões atuais e pelas próximas funções.
create or replace function consulta_regioes_private.usuario_tem_permissao(perfis_permitidos text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.usuarios u
    where u.id = auth.uid()
      and u.ativo is true
      and (lower(u.perfil) = 'admin' or lower(u.perfil) = any(perfis_permitidos))
  );
$function$;

revoke all on function consulta_regioes_private.usuario_tem_permissao(text[])
  from public, anon, authenticated;
grant execute on function consulta_regioes_private.usuario_tem_permissao(text[])
  to authenticated;

-- Atualiza somente a condição de permissão nas duas funções instaladas.
do $update$
declare
  v_nome text;
  v_sql text;
  v_antiga text := 'lower(v_perfil) is distinct from ''operacional''';
  v_nova text := 'not consulta_regioes_private.usuario_tem_permissao(array[''operacional'']::text[])';
begin
  foreach v_nome in array array[
    'consulta_regioes_private.proteger_retornando_base()',
    'consulta_regioes_private.registrar_retornando_base(bigint)'
  ] loop
    v_sql := pg_get_functiondef(v_nome::regprocedure);
    if strpos(v_sql, v_antiga) = 0 and strpos(v_sql, v_nova) = 0 then
      raise exception 'A função % está diferente da versão esperada.', v_nome;
    end if;
    v_sql := replace(v_sql, v_antiga, v_nova);
    v_sql := replace(v_sql,
      'Somente usuários Operacional ativos podem registrar Retornando à base.',
      'Somente usuários Operacional ou Administrativo ativos podem registrar Retornando à base.');
    execute v_sql;
  end loop;
end;
$update$;

notify pgrst, 'reload schema';
commit;

select
  to_regprocedure('consulta_regioes_private.usuario_tem_permissao(text[])') is not null
    as regra_central_criada,
  strpos(pg_get_functiondef('consulta_regioes_private.proteger_retornando_base()'::regprocedure),
    'not consulta_regioes_private.usuario_tem_permissao') > 0 as protecao_atualizada,
  strpos(pg_get_functiondef('consulta_regioes_private.registrar_retornando_base(bigint)'::regprocedure),
    'not consulta_regioes_private.usuario_tem_permissao') > 0 as registro_atualizado,
  not has_function_privilege('anon', 'public.registrar_retornando_base(bigint)', 'execute')
    as anonimo_bloqueado;
