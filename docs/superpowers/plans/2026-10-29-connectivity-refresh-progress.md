# Infinity 0.11.0 — estado verificado em 29/10/2026

## Escopo e diagnóstico

O usuário autorizou atualizar todas as dependências estáveis, corrigir os caminhos de conexão e publicar Windows/Mac/site. Greg e Gui conectam por redes diferentes. O terceiro, também na 0.10.1, permanece sozinho mesmo apenas com Gui na sala. Outra rede não foi testada no PC cabeado.

Os registros locais mostraram duas falhas MQTT `direct` com peer IDs diferentes e uma recriação de rota entre elas. Isso indica negociação inicial tentada, mas não identifica o amigo nem prova entrega completa de candidatos/NAT como causa. A biblioteca não expõe PCs pendentes em `getPeers()`.

Foram corrigidas lacunas demonstradas: rotas silenciosas sem callback, atualização manual antes de 45s, erros sobrescritos entre peers e recuperação impedida mesmo com alternativas saudáveis. Reaberturas são sequenciais e revalidam presença/PC alternativo para todos. A versão Trystero 0.26 também corrige sinalização/rejoin/renegociação upstream; o namespace foi versionado para separar protocolos incompatíveis. Convites e identidades não mudaram.

## Implementação e validação

- 22 dependências diretas atualizadas para latest estável; Electron 45.1.0, Trystero 0.26.0, React 19.3.1, TypeScript 7.0.2, Vite 8.3.5. Node CI 26.13.0 LTS e Actions atuais pinadas por SHA. Node local mínimo 22.12; macOS mínimo 13.
- `npm outdated` retornou `{}`. Auditorias completas e de produção passaram sem vulnerabilidades conhecidas. Residuais transitivos js-yaml/undici foram atualizados dentro dos ranges existentes, sem overrides ou force.
- Configuração única no limite do transporte: Nostr incremental, MQTT/Torrent completos; Google/Cloudflare/Twilio STUN públicos documentados. Nenhum TURN, SFU ou serviço novo foi ativado.
- Diagnóstico de tentativas pendentes registra somente estados e agregados; exportação limitada e testada sem IP/porta/SDP/convite/segredo. Copiar não altera o convite da sala.
- Corrida real no bitrate (`InvalidModificationError` por RTCP durante renegociação) corrigida com aplicação posterior à negociação e cancelamento da configuração anterior. Revisão independente encontrou e eliminou o descarte do preset após 2s; testes incluem atraso 2.1s, último perfil e áudio encerrado.
- TDD: regressões de sessão falharam antes; 19 testes passaram depois. Diagnóstico 3 testes; bitrate 5 testes; MQTT com mensagens incrementais descartadas conecta por candidatos completos.
- **Suíte final: 62/62 passaram (2.5m, workers=1)**, com build atualizado. Inclui três/quatro clientes, três telas, retorno sem reinício, captura/áudio reais e limpeza de helpers no Windows, e assertivas de bitrate 4/10 Mbps em PCs reais do navegador.
- Build Windows completo passou com Electron 45.1.0 e fontes finais. Revisão final sem achados bloqueantes. Nenhum processo do app em uso foi encerrado.

Uma rodada anterior paralela teve falha isolada ao iniciar uma segunda captura (15s). Quatro repetições isoladas e duas rodadas completas sequenciais passaram. Não se demonstrou causa e não se alterou produção por hipótese; o teste agora registra a etapa de getDisplayMedia em caso de nova falha. Isso não é prova de correção desse evento isolado.

## Publicação

Preparação no worktree `codex/connectivity-refresh`, base `21b304e`. A ferramenta nativa não aceita Infinity porque o chat está vinculado ao Merchant; o worktree foi criado por Git, com aprovação, dentro da pasta gravável do chat. Merchant e checkout original foram preservados.

Prévia Vercel pronta: `dpl_H77rws9jTAVfDsbhwFe6PAJnfxqZ`. O projeto existente `infinity-entre-amigos` / Greg Projects foi confirmado pelo conector, sem vínculo Git, Node 24 gerenciado pela Vercel. A prévia foi enviada por arquivos locais e preserva esse estado.

Teste final do executável Windows empacotado passou (1/1, 15.3s), com três processos, duas capturas reais e limpeza de helpers. Nova conferência imediatamente antes do commit: `npm audit` exit 0, zero vulnerabilidades; `npm outdated` retornou `{}`.

Publicação estável concluída: **v0.11.0**, tag no commit `1054696bc948c7a9ed17565c53051b73ffec2c0c`, integrada em main por fast-forward. GitHub Actions **40960367852** passou Windows x64 (2m49), macOS Intel/Apple Silicon (4m12, ambas assinaturas ad hoc verificadas) e publicação. Release não draft/nem prerelease, marcada como latest, 12 assets uploaded, notas em `docs/releases/v0.11.0.md`.

Site de produção **Ready**, deployment `dpl_EyJsjrj3ki364FVRkGSRQwQtcRjS`, alias `https://zeroinfinity.vercel.app/`. HTML público HTTP 200 com aviso 0.11.0 e macOS13; API HTTP200 tag v0.11.0; os três `/baixar/*` retornam302 para os instaladores correspondentes. Manifestos públicos `latest.yml`/`latest-mac.yml` HTTP200 version0.11.0; página pública da release HTTP200. O conector confirmou novamente projeto sem vínculo Git e Node24 gerenciado pela Vercel. A prévia protegida foi lida com autenticação autorizada, sem desativar proteção.

A consulta anônima à API GitHub atingiu limite403 no IP do agente; os metadados da release foram confirmados pela API autenticada e os manifestos/downloads/página pelo acesso público. O serviço do site respondeu200 normalmente. Os32 alertas GitHub ainda abertos tinham atualização anterior ao release:31 não correspondem às versões do lock remoto1054696 e um (sprintf-js/GHSA-hp3w-g68c-fv3c) é advisory retirado oficialmente em22/10. Não se dispensou nenhum alerta para obter o resultado de auditoria.

Windows usa atualização pelo app; Mac continua com download/substituição manual. **Todos devem estar na0.11.0 para se encontrar; convites preservados.** Limites: sem teste WAN no computador afetado; sem teste interativo em hardware Mac; P2P continua dependente das rotas de rede disponíveis.

Release: https://github.com/vitorpbeirigo/tela-entre-amigos/releases/tag/v0.11.0
