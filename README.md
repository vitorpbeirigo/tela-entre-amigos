# Tela

Aplicativo Windows de compartilhamento de tela P2P em alta qualidade para pequenos grupos. Não precisa de cadastro, banco de dados ou servidor próprio.

## Como usar

1. Instale e abra o Tela nos computadores do grupo.
2. Quem vai transmitir clica em **Compartilhar minha tela**, escolhe a tela ou janela e copia o código da sala.
3. Os amigos abrem o aplicativo, colam o código em **Entrar em uma sala** e clicam em **Assistir**.
4. Use fones de ouvido para não devolver o áudio da transmissão pelo microfone.

O anfitrião escolhe entre 1080p a 30 FPS, 1080p a 60 FPS e 1440p a 60 FPS. A qualidade real também depende do computador, da tela selecionada e da rota de internet entre os participantes.

> O instalador ainda não possui certificado de assinatura de código. O Windows SmartScreen pode mostrar um aviso na primeira instalação; escolha **Mais informações** e **Executar assim mesmo** apenas se você recebeu o arquivo deste repositório ou diretamente do responsável pelo grupo.

## Arquitetura

- Electron + React para captura e interface.
- WebRTC para mídia direta entre os computadores.
- Trystero com relays públicos Nostr apenas para descoberta dos computadores.
- Sem banco de dados e sem armazenamento de mídia.

## Desenvolvimento

```powershell
npm.cmd install
npm.cmd run dev
```

## Gerar o instalador

```powershell
npm.cmd run build
```

O instalador será gerado em `artifacts/Tela-Setup-0.1.0.exe`. A pasta é ignorada pelo Git; publique o arquivo em uma GitHub Release ou envie diretamente aos seus amigos.

## Publicar no GitHub

O workflow incluído compila o instalador em uma máquina Windows do GitHub:

```powershell
git remote add origin URL_DO_SEU_REPOSITORIO
git push -u origin main
git tag v0.1.0
git push origin v0.1.0
```

Ao enviar uma tag `v*`, o GitHub Actions cria uma Release com o instalador anexado. Também é possível executar **Build Windows installer** manualmente na aba Actions para baixar o instalador como artefato.

## Privacidade e custo

- O vídeo e o áudio trafegam diretamente entre os computadores por WebRTC e são criptografados em trânsito.
- Relays públicos Nostr são usados somente para os participantes se encontrarem e negociarem a conexão.
- O aplicativo não grava nem armazena a transmissão.
- Não há custo fixo de servidor nesta versão.
- O código da sala funciona como senha: compartilhe apenas com quem deve entrar e crie uma nova sala a cada sessão.

## Limite conhecido do MVP

Esta versão usa descoberta descentralizada e conexão P2P direta. Redes corporativas, CGNATs ou firewalls que bloqueiem a rota direta podem impedir a conexão. Um fallback TURN resolveria esses casos, mas exigiria um serviço de retransmissão e teria custo de banda.
