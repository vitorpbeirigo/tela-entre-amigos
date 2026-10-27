# Infinity

Aplicativo gratuito para Windows e macOS que compartilha a tela inteira e o áudio em alta qualidade diretamente entre amigos. Não precisa de cadastro, banco de dados ou servidor central de vídeo.

## Como usar

1. Instale e abra o Infinity nos computadores do grupo.
2. No primeiro acesso, conclua o assistente de permissões. No Windows, confirme o aviso de administrador para liberar apenas o Infinity no Firewall. No Mac, permita Rede Local e Gravação de Tela quando solicitado.
3. Abra **Salas de amigos**, informe seu nome e crie uma sala. Use **Convidar amigos** para copiar o convite privado.
4. Cada amigo importa o convite uma vez em **Salvar e entrar**. Depois a sala aparece em **Suas salas**, inclusive após fechar e reabrir o aplicativo. O criador não precisa estar conectado.
5. Qualquer pessoa na sala pode **Compartilhar tela**. As transmissões aparecem nos participantes; clique em **Assistir** nas que quiser acompanhar.
6. Abra até quatro transmissões em **Mosaico** ou amplie uma em **Foco**. Escolha qual tela ouvir pelo nome no rodapé de cada vídeo; o volume é individual e só uma tela toca áudio por vez.
7. **Parar compartilhamento** mantém você na sala. **Sair da sala** encerra sua captura e conexões, mas preserva a sala salva e as transmissões dos amigos.

A voz continua no Discord. Enquanto compartilha, o Infinity silencia a reprodução das outras telas neste computador para não retransmitir o áudio recebido. No Windows, mantém o filtro nativo do Discord; no Mac, o compartilhamento do áudio do sistema começa desativado, porque inclui o áudio da chamada. Você pode ativá-lo no seletor quando não estiver ouvindo a chamada pelo Mac.

O convite contém a chave de acesso: envie somente aos amigos. Quem tiver o convite pode entrar sem aprovação adicional. **Esquecer sala** remove só a cópia local; não revoga o acesso dos outros. Limpar os dados do app ou trocar de computador pode exigir importar o convite novamente. Nesta versão não há lista administrativa de membros nem banimento remoto.

O modo anterior continua disponível em **Compartilhar minha tela** / **Entrar em uma sala**: código por transmissão, aprovação inicial manual, retorno sem nova aprovação na mesma transmissão e revogação pelo anfitrião.

O anfitrião escolhe entre 720p30, 1080p30, 1080p60 e 1440p60. A qualidade pode ser alterada ao vivo sem desconectar ninguém nem trocar o código. Para jogar, use **Jogar**: 720p, 30 FPS e 4 Mbps, com menor uso da GPU e prévia local pausada.

## Instalar no macOS

- `Infinity-<versão>-mac-arm64.dmg`: Apple Silicon (M1, M2, M3, M4 ou mais novo).
- `Infinity-<versão>-mac-x64.dmg`: Macs Intel.
- Recomendado: macOS 13 ou mais recente para capturar o áudio do sistema sem driver virtual.

Esta edição gratuita usa assinatura ad hoc local, sem certificado Developer ID e sem notarização paga da Apple. Por isso o macOS pode bloquear a primeira abertura mesmo sem ter detectado malware.

1. Arraste o Infinity para **Aplicativos** e tente abri-lo uma vez.
2. Abra **Ajustes do Sistema > Privacidade e Segurança**.
3. Role até Segurança, clique em **Abrir Mesmo Assim** e confirme em **Abrir**.
4. Ao transmitir, permita **Gravação de Tela e Áudio do Sistema**, feche completamente o Infinity e abra novamente.

Se **Abrir Mesmo Assim** não aparecer, use apenas como último recurso:

```bash
xattr -dr com.apple.quarantine "/Applications/Infinity.app"
```

O comando remove a quarentena somente desse aplicativo. Faça isso apenas com o arquivo baixado pelo site ou repositório oficial. As atualizações do Mac continuam manuais; no Windows, são automáticas.

## Arquitetura e privacidade

- Electron + React para captura e interface.
- WebRTC para mídia P2P criptografada em trânsito.
- Trystero com Nostr, MQTT e Torrent em paralelo para descoberta redundante; apenas uma rota de mídia por espectador.
- Salas permanentes usam P2P direto e senha de alta entropia do convite. Presença e interesse são trocados entre os participantes; o vídeo só começa quando alguém pede para assistir.
- Até 20 salas ficam salvas localmente. A identificação do dispositivo serve para continuidade da interface, não como prova de autoridade; o nome não concede acesso.
- O modo temporário preserva aprovação manual, desafio HMAC de retorno vinculado à transmissão e descoberta da configuração TURN anterior. As novas salas não acrescentam relay de mídia.
- Renderer isolado, sandbox do Chromium, CSP restritiva e IPC validado.
- Sem contas, banco de dados ou armazenamento da transmissão.

Relays de descoberta não transportam o vídeo. Redes que bloqueiam a conexão direta podem impedir a entrada ou reprodução; sala salva não elimina CGNAT/firewalls restritivos. Cada espectador acrescenta uma cópia enviada pela pessoa que compartilha; o mosaico também exige decodificar várias telas no computador de quem assiste.

## Desenvolvimento

```powershell
npm.cmd install
npm.cmd run dev
```

Verificações:

```powershell
npm.cmd run typecheck
npm.cmd run test:ui
npm.cmd run build:web
```

Para testar a captura nativa e as reconexões, execute `npm.cmd run build:web` antes de `npx.cmd playwright test tests/electron.spec.ts`. Os testes reais Electron verificam captura, áudio, reconexão do modo antigo e salas salvas com dois transmissores e um espectador. O teste `friends-live.spec.ts` usa três clientes WebRTC, confirma quadros decodificados no mosaico, foco único de áudio, mudança de qualidade, retorno após reload e funcionamento sem criador. Esses testes dependem dos canais públicos de descoberta; os testes Electron também precisam das permissões de captura locais.

A fila PCM do Windows é limitada a 120 ms; se houver sobrecarga, descarta áudio antigo e volta a 40 ms, em vez de reproduzir segundos de atraso. Pacotes de áudio presos no IPC por mais de 150 ms são descartados. Isso reduz uma fonte de atraso, mas não é uma garantia de latência total: rede, codificação, buffer do receptor e dispositivo de saída também influenciam. Em P2P o anfitrião envia uma cópia por espectador.

Gerar o instalador Windows:

```powershell
npm.cmd run build
```

O arquivo é criado em `artifacts/Infinity-Setup-<versão>.exe`, junto do manifesto de atualização e `.blockmap`. Os pacotes macOS são gerados pelo GitHub Actions ou num Mac com `npm run build:mac`.

Esta implementação usa `0.10.0-beta.1` para o instalador de teste local. Não há nova release pública nem atualização automática publicada por esta branch.

## Publicar

```powershell
git push origin main
git tag vX.Y.Z
git push origin vX.Y.Z
```

O workflow **Build Infinity installers** gera Windows x64, macOS Intel e macOS Apple Silicon e publica os arquivos na Release quando recebe uma tag. O site em `https://zeroinfinity.vercel.app/` consulta a release mais recente pelo serviço `website/api/releases.js`.

O `appId` antigo e o identificador da rede P2P foram preservados intencionalmente para que usuários da versão Tela recebam a atualização e continuem encontrando as mesmas salas durante a transição.
