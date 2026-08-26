# Tela

Aplicativo Windows e macOS de compartilhamento de tela P2P em alta qualidade para pequenos grupos. Não precisa de cadastro, banco de dados ou servidor próprio.

## Como usar

1. Instale e abra o Tela nos computadores do grupo.
2. Quem vai transmitir clica em **Compartilhar minha tela**, escolhe a tela ou janela e copia o código da sala.
3. Os amigos abrem o aplicativo, colam o código em **Entrar em uma sala** e clicam em **Assistir**.
4. Use fones de ouvido para não devolver o áudio da transmissão pelo microfone.

O anfitrião escolhe entre 1080p a 30 FPS, 1080p a 60 FPS e 1440p a 60 FPS. A qualidade real também depende do computador, da tela selecionada e da rota de internet entre os participantes.

> Os instaladores ainda não possuem certificado de assinatura de código. No Windows, o SmartScreen pode pedir **Mais informações** e **Executar assim mesmo**. No macOS, abra o aplicativo com o botão direito e escolha **Abrir**; se necessário, use **Ajustes do Sistema > Privacidade e Segurança > Abrir Mesmo Assim**. Faça isso somente com arquivos deste repositório ou recebidos diretamente do responsável pelo grupo.

## Usar no macOS

- `Tela-0.3.1-mac-arm64.dmg`: Macs com Apple Silicon (M1, M2, M3, M4 ou mais novo).
- `Tela-0.3.1-mac-x64.dmg`: Macs Intel.
- Recomendado: macOS 13 ou mais recente para capturar também o áudio do sistema sem instalar um driver virtual.

Na primeira transmissão, o macOS pedirá acesso à gravação de tela e ao áudio do sistema. Autorize o **Tela** em **Ajustes do Sistema > Privacidade e Segurança**, feche o aplicativo completamente e abra novamente. Se a permissão estiver bloqueada, o próprio Tela mostra um botão para abrir esses ajustes.

Como esta edição é gratuita, ela usa uma assinatura ad hoc local em vez de um certificado pago da Apple. As atualizações do Mac são manuais: baixe o `.dmg` mais recente na página de Releases e substitua o aplicativo anterior. A atualização automática continua disponível no Windows.

Se o macOS ainda mostrar **“mover para o lixo”**, mova primeiro o Tela para **Aplicativos** e execute no Terminal:

```bash
xattr -dr com.apple.quarantine "/Applications/Tela.app"
```

Esse comando remove a quarentena somente desse aplicativo. Depois, clique com o botão direito no Tela e escolha **Abrir**.

## Arquitetura

- Electron + React para captura e interface.
- WebRTC para mídia direta entre os computadores.
- Trystero com relays públicos Nostr e MQTT em paralelo para descoberta redundante dos computadores.
- Fallback TURN carregado por configuração remota quando a conexão direta é bloqueada.
- Atualizações automáticas distribuídas por GitHub Releases.
- Sem banco de dados e sem armazenamento de mídia.

## Desenvolvimento

```powershell
npm.cmd install
npm.cmd run dev
```

## Gerar os instaladores

```powershell
npm.cmd run build
```

No Windows, o instalador será gerado em `artifacts/Tela-Setup-0.3.1.exe`, junto de `latest.yml` e do arquivo `.blockmap` usados pelo atualizador.

Os pacotes macOS devem ser gerados num Mac ou pelo workflow do GitHub Actions:

```bash
npm run build:mac
```

O comando produz `.dmg` e `.zip` separados para Intel (`x64`) e Apple Silicon (`arm64`) dentro de `release/`. A versão gratuita usa assinatura ad hoc, sem certificado Developer ID e sem notarização paga da Apple.

## Publicar no GitHub

O workflow incluído compila o instalador em uma máquina Windows do GitHub:

```powershell
git remote add origin URL_DO_SEU_REPOSITORIO
git push -u origin main
git tag v0.3.1
git push origin v0.3.1
```

Ao enviar uma tag `v*`, o GitHub Actions compila Windows, macOS Intel e macOS Apple Silicon e cria uma Release com todos os instaladores anexados. Também é possível executar **Build Tela installers** manualmente na aba Actions para baixar os arquivos como artefatos.

No Windows, o Tela verifica Releases, baixa novas versões em segundo plano e mostra o botão **Reiniciar agora** quando a atualização estiver pronta. No macOS gratuito e não assinado, cada nova versão precisa ser instalada manualmente.

## Ativar o fallback TURN

O arquivo `network.json` é consultado em cada sessão. Defina `turnCredentialsUrl` com um endpoint HTTPS que devolva `{ "iceServers": [...] }`. O endpoint deve gerar credenciais temporárias e manter a chave administrativa do provedor apenas no servidor. Alterar esse arquivo no GitHub ativa ou troca o TURN sem recompilar o aplicativo.

## Privacidade e custo

- O vídeo e o áudio trafegam diretamente entre os computadores por WebRTC e são criptografados em trânsito.
- Relays públicos Nostr e MQTT são usados somente para os participantes se encontrarem e negociarem a conexão.
- O aplicativo não grava nem armazena a transmissão.
- A conexão direta continua sem custo. TURN só transporta mídia quando a rede direta falha e consome a franquia do provedor.
- O código da sala funciona como senha: compartilhe apenas com quem deve entrar e crie uma nova sala a cada sessão.

## Limite conhecido do MVP

Esta versão usa descoberta descentralizada e conexão P2P direta. Redes corporativas, CGNATs ou firewalls que bloqueiem a rota direta podem impedir a conexão. Um fallback TURN resolveria esses casos, mas exigiria um serviço de retransmissão e teria custo de banda.
