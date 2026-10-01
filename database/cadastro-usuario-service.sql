-- A Edge Function valida o JWT e exige Administrador ativo antes de criar contas.
-- O serviço precisa ler o perfil do solicitante e as rotas, e inserir o novo perfil.
grant select, insert on table public.usuarios to service_role;
grant select on table public.rotas to service_role;
