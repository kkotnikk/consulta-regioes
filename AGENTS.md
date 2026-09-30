# Consulta Regiões

## Permissões

- O perfil `admin` (Administrativo) ativo tem acesso a todas as funções do site, incluindo permissões adicionadas no futuro. Um usuário inativo não recebe acesso.
- No frontend, use `usuarioTemPermissao(perfisPermitidos, usuario)` para verificar permissões. Uma lista vazia representa uma ação exclusiva do Administrativo; o Administrativo também passa em listas destinadas ao Operacional.
- No banco, novas funções e políticas devem reconhecer o Administrativo. Reutilize `consulta_regioes_private.usuario_tem_permissao(text[])` para verificar o perfil do usuário autenticado na tabela `public.usuarios`.
- A interface não substitui a autorização no banco. Mantenha a verificação de permissão em cada operação de escrita. Não conceda permissões administrativas aos demais perfis.
- Preserve o escopo solicitado e as animações existentes ao alterar a interface.
