# Progresso — plano: docs/superpowers/plans/2026-10-27-salas-de-amigos.md

Base: c341f234d23a287d55b4bd0b3c184509aa6c9b2f. Branch: codex/saved-friends-rooms. Execução nativa neste checkout limpo, preservando main.

Design aprovado pelo pedido explícito do usuário para executar a proposta da conversa. Plano registrado para execução contínua.

Pre-flight: Task 3 consome SavedRoom da Task 1 e FriendsSession/captureDesktopStream da Task 2. Task 4 verifica ambos os fluxos. Nenhum conflito de interfaces.

Decisão: controlar acesso pelo convite privado; identidade local só identifica participante. Sem administrador/ban remoto nesta versão, pois não foi solicitado.

Decisão: silenciar reprodução de telas enquanto captura para impedir que o áudio recebido seja transmitido de volta. O vídeo continua disponível.

Task 1: complete — 3 testes de convite/persistência passaram; identidade e segredo preservados após carregar novamente.
Task 2: complete — 4 testes do controlador e typecheck passaram; extraiu captura/qualidade existentes e manteve filtro nativo.
Task 3: complete — 3 testes de interface passaram, incluindo armazenamento, tamanho mínimo e captura Mac sem retorno por padrão.
Task 4: complete — integração de três clientes WebRTC passou (dois transmissores, mosaico, áudio único, alteração de qualidade, rewatch, reload/reentrada e continuidade sem criador).

Regressão encontrada e corrigida: Trystero devolvia stream vazio ao voltar a assistir. Cada assinatura agora tem watchId e MediaStream próprios usando as mesmas faixas locais, sem nova captura. Teste de integração falhou antes e passou depois.

Revisão independente: dois achados importantes, nenhum crítico/minor. Corrigidos com três testes que falharam antes e passaram depois: (1) serializar attach/remove por destinatário e desfazer adições tardias; (2) repetir leave após fechar PCs se o primeiro envio de saída falhar. O fechamento normal também libera os PCs compartilhados após a saída.

Verificações adicionais: presença remota agora copia só campos validados (não aceita estado interno injetado); storage bloqueado não derruba o App. Ambos tiveram regressão vermelha antes da correção. 12 testes do controlador/UI passaram após os ajustes.

Suíte anterior à revisão: 34/34 passed (1.3m). A execução final abaixo inclui as correções e o teste nativo com três apps, duas capturas reais e liberação dos helpers.

## Verificação final — 27/10/2026

- Suíte completa após ajustes: **40/40 passed (1.3m)**, incluindo teste nativo novo serializado no arquivo de testes Electron.
- Instalador Windows: **build:win exit 0**; typecheck, bundle e helper compilados. Apenas aviso de tamanho do bundle já existente; dependências não alteradas.
- Teste separado contra `AppData/Local/InfinityBuild/win-unpacked/Infinity.exe`: **1/1 passed (14.6s)**, três perfis, duas capturas de desktop reais, espectador com ambas as faixas de áudio e vídeo decodificado; reload da sala salva e helpers encerrados ao sair.
- Helper incluído no pacote corresponde por SHA-256 ao helper compilado. `TelaAudioCapture.exe --self-test`: exit 0.
- Screenshot do mosaico inspecionado em `artifacts/qa/friends-mosaic.png`. Layout mínimo 960×680 verificado por teste.
- Pacote local: `artifacts/Infinity-Setup-0.10.0-beta.1.exe` (117029004 bytes na compilação verificada).
- Revisão independente: ambos os achados importantes corrigidos com regressões vermelhas antes da mudança; sem minors adiados.

Limites: não testado em hardware macOS nem entre redes/operadoras diferentes. Os testes reais ocorreram nesta máquina em processos/perfis separados. Não houve chamada real do Discord durante esta validação; filtro nativo existente foi preservado. Quem possui o convite pode entrar; não há banimento remoto. Compartilhar silencia reprodução das outras telas para evitar recaptura.

Ao encerrar a etapa de implementação/teste, o pacote local estava identificado como 0.10.0-beta.1; não havia publicação naquela etapa.

## Publicação autorizada — 27/10/2026

O usuário autorizou publicar para todos, incluindo Windows, Mac e downloads do site.

- Versão estável: **v0.10.0**, tag no commit `669a913e7a671482b12bafd4b9010cce2512391b`. A branch de implementação foi integrada em main por fast-forward.
- QA antes da tag: typecheck exit 0 e **40/40 testes passed (1.3m, workers=2)**. Uma execução anterior foi interrompida com janela Electron fechada; a execução completa posterior passou.
- GitHub Actions **40597419390** concluiu com sucesso: Windows x64, macOS Intel/Apple Silicon e publicação da release. As assinaturas ad hoc de ambos os aplicativos Mac foram verificadas no job macOS.
- Release pública, estável, marcada como mais recente, com 12 assets em estado uploaded. Título/notas publicados a partir de `docs/releases/v0.10.0.md`.
- Endpoint público `https://zeroinfinity.vercel.app/api/releases`: HTTP 200, tag v0.10.0 e os três instaladores corretos.
- As rotas `/baixar/windows`, `/baixar/mac-arm64` e `/baixar/mac-x64` retornaram HTTP 302 para seus respectivos assets v0.10.0. O serviço existente atualizou os downloads automaticamente, sem precisar de outra implantação do site.
- `latest.yml` e `latest-mac.yml` públicos retornaram HTTP 200 e version 0.10.0. O manifesto Windows aponta para `Infinity-Setup-0.10.0.exe`; o do Mac inclui x64 e arm64.
- Windows segue com atualização automática ao abrir; macOS segue com download/substituição manual.

Release: https://github.com/vitorpbeirigo/tela-entre-amigos/releases/tag/v0.10.0

Limite da publicação: build/assinatura Mac comprovados pelo CI, sem teste interativo em hardware Mac. Os testes de conexão foram realizados nesta máquina; conectividade entre operadoras/rede restritiva permanece dependente de P2P.

## Recuperação de participantes — 27/10/2026

Após a publicação, um amigo apareceu sozinho enquanto dois participantes se encontravam. Depois o usuário confirmou os três conectados e transmitindo: não havia limite de duas pessoas. Sem o erro original detalhado, não foi possível atribuir a ocorrência a firewall, NAT ou estratégia específica.

O código mantinha um alerta genérico mesmo quando outra estratégia conectava o mesmo participante. Pedidos de vídeo também podiam ficar esperando uma rota sem receber a primeira mídia. A versão 0.10.1 limpa o alerta ao recuperar, tenta renegociar transportes interrompidos e troca o pedido de vídeo após 15 segundos sem mídia. Rotas de descoberta vazias que falharam são reabertas com intervalo crescente; rotas que já têm participantes permanecem intactas. Diagnósticos locais registram categorias, sem convite/senha/IP/SDP. Nenhum TURN ou servidor de vídeo foi adicionado.

A revisão independente identificou uma corrida durante o `leave()` assíncrono do Trystero: presença tardia na rota em encerramento e restauração de aviso já resolvido. O patch ignora a presença dessa rota e transfere somente a falha ainda pendente; teste de regressão passou. Revisão final sem bloqueios.

Validação da revisão final: **47/47 testes passaram (1.2m, workers=2)**, incluindo três e quatro clientes WebRTC, terceiro cliente inicialmente sem rede que aparece após a rede voltar, três transmissões simultâneas em mosaico, continuidade das telas existentes e capturas reais no Electron. Typecheck passou no build. As seis regressões de recuperação foram adicionadas à suíte de sessão (14 testes no total).

Limite: testes multicliente locais não comprovam conectividade entre quaisquer operadoras. P2P puro continua sujeito às restrições de rede; a correção recupera falhas transitórias, sem prometer conexão universal. Publicação 0.10.1 ainda pendente neste registro.
