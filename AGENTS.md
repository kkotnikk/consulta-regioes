# Consulta Regiões

## Perfis e permissões

- Cada pessoa utiliza uma conta individual com nome próprio, e-mail e senha. Não criar contas compartilhadas por perfil.
- `admin` (Administrador) ativo pode ter até três rotas vinculadas como referência, sem restringir seu acesso às demais. Tem TODAS as permissões existentes e futuras. Toda autorização nova deve usar o helper central que inclui Administrador.
- `operador_coleta` (Operador Coleta) ativo visualiza todas as rotas. Só marca “Retornando à base” nas rotas atribuídas (de uma até três) em `usuarios.rotas_coleta_ids`. Pode acessar, editar e imprimir o relatório.
- `operador_conferencia` (Operador Conferência) ativo visualiza todas as rotas e marca “Retorno confirmado”. Não possui acesso ao relatório nem ações administrativas.
- Visitantes e usuários inativos não acessam rotas, relatório ou administração. A consulta pública de bairros e o envio de sugestões/chamados permanecem disponíveis.
- No frontend, use `usuarioTemPermissao(perfisPermitidos, usuario)`. Lista vazia significa somente Administrador. Para ações por rota use `usuarioPodeRetornarRota(id, usuario)`; para confirmação `usuarioPodeConfirmarRetorno(usuario)`; para relatório `usuarioPodeAcessarRelatorio` e `usuarioPodeEditarRelatorio`.
- No banco, use `consulta_regioes_private.usuario_tem_permissao(text[])` e `usuario_pode_retornar_rota(bigint)`. A interface não substitui RLS/RPC/trigger. Operadores não podem editar seus perfis nem alterar cadastros administrativos.
- A criação de contas utiliza a Edge Function `criar-usuario`, com validação de JWT e Administrador ativo. Chaves de serviço nunca são expostas no frontend.
- A conta legada “Operacional Teste” foi convertida em Coleta desativado. O Administrador deve informar o nome individual e de uma até três rotas antes de ativar.

## Relatório e animações

- O conteúdo do relatório permanece vazio conforme pedido. Mantenha o botão de impressão no canto superior direito.
- Quando o editor do relatório for implementado, aplique a permissão Coleta + Administrador também no backend.
- Preserve animações suaves de entrada, rolagem, modais e transições de tela; o menu permanece fixo.
