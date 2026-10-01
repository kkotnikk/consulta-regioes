# Consulta Regiões

## Perfis e permissões

- Cada pessoa utiliza uma conta individual com nome próprio, e-mail e senha. Não criar contas compartilhadas por perfil.
- `admin` (Administrador) ativo pode ter qualquer quantidade de rotas vinculadas como referência, sem restringir seu acesso às demais. Tem TODAS as permissões existentes e futuras. Toda autorização nova deve usar o helper central que inclui Administrador.
- `operador_coleta` (Operador Coleta) ativo visualiza todas as rotas. Só marca “Retornando à base” nas rotas atribuídas (uma ou mais, sem limite de quantidade) em `usuarios.rotas_coleta_ids`. Pode acessar, editar e imprimir o relatório.
- `operador_conferencia` (Operador Conferência) ativo visualiza todas as rotas e marca “Retorno confirmado”. Não possui acesso ao relatório nem ações administrativas.
- Visitantes e usuários inativos não acessam rotas, relatório ou administração. A consulta pública de bairros e o envio de sugestões/chamados permanecem disponíveis.
- No frontend, use `usuarioTemPermissao(perfisPermitidos, usuario)`. Lista vazia significa somente Administrador. Para ações por rota use `usuarioPodeRetornarRota(id, usuario)`; para confirmação `usuarioPodeConfirmarRetorno(usuario)`; para relatório `usuarioPodeAcessarRelatorio` e `usuarioPodeEditarRelatorio`.
- No banco, use `consulta_regioes_private.usuario_tem_permissao(text[])` e `usuario_pode_retornar_rota(bigint)`. A interface não substitui RLS/RPC/trigger. Operadores não podem editar seus perfis nem alterar cadastros administrativos.
- A criação de contas utiliza a Edge Function `criar-usuario`, com validação de JWT e Administrador ativo. Chaves de serviço nunca são expostas no frontend.
- Preserve os privilégios de `database/cadastro-usuario-service.sql`: o serviço lê perfis/rotas e insere o novo perfil após validar o Administrador. Falhas na consulta de autorização devem retornar erro de serviço, sem afirmar que o solicitante não é Administrador.
- No cadastro/edição, o botão “+” revela mais seletores de rota, sem limite de quantidade. Permita remover vínculos adicionais. Ao editar, exiba todos os vínculos existentes. Histórico e Usuários possuem quadros de mesma largura/altura na mesma linha; mantenha espaço abaixo de Cadastrar usuário.
- A conta legada “Operacional Teste” foi convertida em Coleta desativado. O Administrador deve informar o nome individual e uma ou mais rotas antes de ativar.

## Relatório e animações

- O relatório possui páginas numeradas dinamicamente para todas as rotas vinculadas ao usuário, sem truncar a lista em três. A navegação possui rolagem horizontal quando necessário. Páginas sem rota ficam desabilitadas. Cada usuário possui um PDF próprio por rota; reenviar substitui somente esse arquivo. O visualizador ocupa somente a área de conteúdo, sem cobrir o menu, o cabeçalho ou as ações.
- PDFs ficam no bucket privado `relatorios` (até 20 MB), no caminho `usuario_id/rota_id/uuid.pdf`. A tabela `relatorios_por_rota` tem chave composta `(usuario_id,rota_id)`. Coleta ativo só acessa arquivos próprios de rotas atualmente vinculadas; Conferência, visitantes e inativos não acessam. Administrador ativo mantém todas as permissões no banco. A opção “Meus relatórios” exibe os próprios vínculos. Administrador possui também “Relatórios dos usuários”, com seleção de pessoa e páginas por rota; inclua os PDFs existentes mesmo que a rota tenha sido desvinculada ou o usuário desativado. Coleta continua acessando somente os próprios PDFs de vínculos atuais.
- No relatório, separe o solicitante autenticado do dono do documento selecionado. A consulta de outros usuários exige Administrador ativo e permite visualizar/imprimir. Os envios normais permanecem no próprio perfil; a consulta de outros oculta os controles de envio. Mantenha a proteção contra respostas atrasadas ao trocar pessoa, rota ou sessão e limpe nomes/metadados/PDF ao perder o perfil administrativo.
- No PDF, “✓ Concluída” marca um ponto da coleta e “Comentário” insere texto de até 300 caracteres. As anotações ficam em `relatorio_anotacoes`, separadas por usuário, rota, caminho de arquivo e página; posições proporcionais acompanham zoom e impressão. Clique em uma anotação para editar/remover. Administrador pode anotar também PDFs dos demais; Coleta só os próprios de vínculos atuais. Preserve autor, RLS, salvamento confirmado e proteção contra respostas atrasadas. Substituir PDF limpa apenas as marcações desse arquivo, sem transportar conclusões para o relatório do dia seguinte.
- Use `consulta_regioes_private.usuario_pode_acessar_relatorio_rota(uuid,bigint)` nas autorizações por relatório. O relatório global legado está preservado e sem acesso dos clientes. A interface não substitui as políticas de Storage e da tabela.
- `relatorio-pdf-viewer.html` exibe as páginas com PDF.js, rolagem interna e preparação da impressão. Mantenha biblioteca e worker na mesma versão; não execute scripts embutidos no PDF. Os testes do visualizador aceitam `PDFJS_MODULE_PATH` e `PDFJS_WORKER_PATH` para os módulos de teste.
- As folhas do PDF aparecem lado a lado, com rolagem interna horizontal. No zoom inicial, cada folha se ajusta à largura e à altura disponíveis. Ctrl + roda do mouse altera somente o zoom do PDF; os botões −/+/Ajustar permitem o mesmo no celular. Preserve a impressão de cada folha em sua própria página e a moldura arredondada sem cortar o conteúdo.
- Atualize a versão no endereço do iframe quando mudar o visualizador, para evitar o carregamento de versões antigas em cache.
- Dentro do PDF, clicar e segurar o botão esquerdo permite arrastar horizontal e verticalmente. Preserve o zoom com Ctrl, as barras de rolagem e a rolagem nativa por toque.
- Apenas três atalhos administrativos: “Bairros e rotas”, “Suporte e sugestões”, “Histórico e usuários”. Abertura animada para baixo; o primeiro rola ao topo do gerenciamento.
- O relatório vazio possui área pontilhada “Soltar PDF”, com seleção por clique/teclado ou arrastar e soltar. Um único arquivo por envio, sempre na rota selecionada, usando a mesma validação e autorização do botão Enviar PDF.
- Preserve animações suaves de entrada, rolagem, modais e transições de tela; o menu permanece fixo.

## Avisos de rodízio

- Final 1/2: segunda; 3/4: terça; 5/6: quarta; 7/8: quinta; 9/0: sexta. Use `rodizioDaPlaca` e `placaComAviso` para todas as placas exibidas. Vermelho “Rodízio hoje”, laranja “Rodízio amanhã”.
- Use o dia civil de `America/Sao_Paulo`; amanhã significa o próximo dia do calendário. Ignore fins de semana e feriados nacionais/estaduais/municipais de São Paulo, incluindo Sexta-feira Santa e Corpus Christi. Não trate pontos facultativos nem suspensões exclusivas para carros de passeio como liberação de caminhões.
- Fonte: https://www.cetsp.com.br/rodizio.aspx e https://prefeitura.sp.gov.br/web/gestao/w/calendario_2026, conferidas em 01/10/2026. O aviso identifica o dia pelo final da placa; não determina isenções individuais, enquadramento geográfico ou suspensões extraordinárias futuras.
- Preserve os avisos em cartões públicos/administrativos, detalhes, histórico, cabeçalho de relatório, seleção de rotas do usuário e digitação de placa em cadastro/edição. Atualize no retorno à aba e a cada 30 segundos, sem recriar o PDF ou interromper a digitação.
