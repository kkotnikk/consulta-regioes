# Consulta Regiões

## Permissões

- O perfil `admin` (Administrativo) ativo tem acesso às funções gerais do site, incluindo permissões adicionadas no futuro. A confirmação de retorno é a exceção: exclusiva do perfil `operacional` ativo, conforme pedido do usuário. Um usuário inativo não recebe acesso.
- No frontend, use `usuarioTemPermissao(perfisPermitidos, usuario)` para verificar permissões. Uma lista vazia representa uma ação exclusiva do Administrativo; o Administrativo também passa em listas destinadas ao Operacional.
- No banco, novas funções e políticas devem reconhecer o Administrativo. Reutilize `consulta_regioes_private.usuario_tem_permissao(text[])` para verificar o perfil do usuário autenticado na tabela `public.usuarios`.
- A interface não substitui a autorização no banco. Mantenha a verificação de permissão em cada operação de escrita. Não conceda permissões administrativas aos demais perfis.
- Para confirmar retorno, use `usuarioPodeConfirmarRetorno(usuario)` no frontend e a validação exclusiva de `operacional` na RPC e no trigger `proteger_confirmacao_retorno`. Não use a regra geral que autoriza o Administrativo nessa ação.
- Preserve o escopo solicitado e as animações existentes ao alterar a interface.

## Pendências solicitadas

- Relatório (registrado em 01/10/2026): ao implementar o relatório, permitir acesso somente a usuários autenticados e ativos dos perfis `admin` (Administrativo) e `operacional` (Operacional/Operador). Visitantes, usuários inativos e outros perfis não devem ter acesso. O usuário pediu apenas guardar esta regra para adicionar depois; não aplicar a restrição nesta etapa.
