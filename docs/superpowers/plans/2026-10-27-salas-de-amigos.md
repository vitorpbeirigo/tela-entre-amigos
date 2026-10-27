# Salas de amigos — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Salas privadas persistentes com vários transmissores e mosaico de até quatro telas.

**Architecture:** Preservar App e fluxo antigo. Compartilhar a captura e configuração de qualidade existentes com uma nova interface de salas; armazenar convites localmente e gerenciar presença/assinaturas por participante em um controlador P2P.

**Tech Stack:** React, TypeScript, Electron, Web Crypto, Trystero e Playwright existentes.

**Spec:** `docs/superpowers/specs/2026-10-27-salas-de-amigos-design.md`

## Global Constraints

- Sem nova dependência, banco ou servidor de vídeo. Voz no Discord.
- Até quatro telas assistidas; uma transmissão local. Apenas foco com áudio; silenciar reprodução durante captura.
- Nunca registrar convite/segredo. Não publicar release nesta tarefa.

## Review Focus

- Convite malformado ou armazenamento indisponível: erro claro, não falso sucesso de persistência.
- Eventos tardios ao sair/trocar de sala: não reabrir captura nem anexar vídeo antigo.
- Múltiplas estratégias: uma transmissão por espectador; falha da rota selecionada troca de rota.
- Fim/reinício de tela: não afetar outras pessoas; remoção e retorno sem faixas mortas.
- Qualquer participante pode transmitir: evitar retorno digital de áudio ao assistir e compartilhar.

### Task 1: Convites e persistência

Files: `src/saved-rooms.ts`, `tests/saved-rooms.spec.ts`.
Interfaces: `SavedRoom`, `createSavedRoom(name)`, `parseRoomInvite(text)`, `roomInvite(room)`, `loadSavedRooms()`, `saveRoom(room)`, `forgetRoom(id)`, `loadLocalIdentity()`.
- [x] Testar round-trip, validação, persistência, identidade estável e storage indisponível; observar falha antes de implementar.
- [x] Implementar formatos versionados e armazenamento limitado/validado; executar testes.

### Task 2: Captura compartilhada e controlador P2P

Files: `src/screen-media.ts`, `src/friends-session.ts`, `src/App.tsx`, `tests/friends-session.spec.ts`.
Interfaces: `QUALITY_PRESETS`, `captureDesktopStream(options)`, `configureVideoSender(pc,preset)`; `FriendsSession` controla `watch`, `unwatch`, `setStream`, `setQuality`, `close` e snapshots de participantes/mídia.
- [x] Testar envio sob demanda, deduplicação, stop/restart, failover e eventos após fechamento com transporte controlado.
- [x] Extrair captura/configuração existentes sem mudar o fluxo antigo. Implementar presença e inscrições, reusando clonagem de playback.
- [x] Rodar testes de protocolo e typecheck.

### Task 3: Interface de salas e mosaico

Files: `src/FriendsHub.tsx`, `src/friends.css`, `src/App.tsx`, `tests/friends-ui.spec.ts`.
Interfaces: componente recebe plataforma, callback de captura existente, callback de parada de áudio e retorno à home.
- [x] Testar criação, importação, reload, sala salva, seleção de fonte e modo antigo.
- [x] Construir lista de salas, participantes, convites, seletor de captura e palco com foco/mosaico/volume. Tratar permissões, captura pendente e cleanup.
- [x] Verificar tamanho mínimo, teclado e estados vazios/erro.

### Task 4: Integração, revisão e entrega

Files: `tests/friends-live.spec.ts`, `README.md`, documento de progresso.
- [x] Testar três clientes reais com dois streams, mosaico, stop/restart, reentrada e ausência do criador.
- [x] Executar suíte completa, typecheck e build Windows. Inspecionar pacote e layout.
- [x] Revisão independente do diff; corrigir problemas relevantes com teste de regressão.
- [x] Registrar estado verificado e limites na documentação. Entregar instalador local sem publicar.
