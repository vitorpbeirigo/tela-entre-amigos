# Infinity

Aplicativo gratuito para Windows e macOS que compartilha a tela inteira e o áudio em alta qualidade diretamente entre amigos. Não precisa de cadastro, banco de dados ou servidor central de vídeo.

## Como usar

1. Instale e abra o Infinity nos computadores do grupo.
2. No primeiro acesso, conclua o assistente de permissões. No Windows, confirme o aviso de administrador para liberar apenas o Infinity no Firewall. No Mac, permita Rede Local e Gravação de Tela quando solicitado.
3. Quem transmite escolhe **Compartilhar minha tela**, seleciona a tela ou janela e copia o código privado.
4. Os amigos informam o nome, colam o código em **Entrar em uma sala** e pedem para assistir.
5. O anfitrião aprova cada pessoa uma vez por transmissão. No mesmo computador/perfil, ela pode sair e voltar (inclusive reabrir o app) sem pedir novamente. **Remover** revoga esse acesso. Uma nova transmissão exige nova aprovação.
6. Quem assiste controla ou silencia o volume sem afetar os demais.

O anfitrião escolhe entre 720p30, 1080p30, 1080p60 e 1440p60. A qualidade pode ser alterada ao vivo sem desconectar ninguém nem trocar o código. Para jogar, use **Jogar**: 720p, 30 FPS e 4 Mbps, com menor uso da GPU e prévia local pausada.

## Instalar no macOS

- `Infinity-0.9.6-mac-arm64.dmg`: Apple Silicon (M1, M2, M3, M4 ou mais novo).
- `Infinity-0.9.6-mac-x64.dmg`: Macs Intel.
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
- Trystero com Nostr e MQTT em paralelo para descoberta redundante.
- Fallback TURN carregado por configuração remota quando a rota direta falha.
- Aprovação inicial manual e retorno autenticado por desafio HMAC, vinculado à transmissão e às identidades dos dois computadores. O nome não concede acesso. O anfitrião guarda as autorizações apenas enquanto transmite; o espectador mantém até 20 credenciais locais de salas recentes (não a mídia).
- Renderer isolado, sandbox do Chromium, CSP restritiva e IPC validado.
- Sem contas, banco de dados ou armazenamento da transmissão.

Relays de descoberta não transportam o vídeo. O TURN só transporta mídia quando a conexão direta é bloqueada e, nesse caso, consome banda do provedor configurado.

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

Para testar a captura nativa e as reconexões, execute `npm.cmd run build:web` antes de `npx.cmd playwright test tests/electron.spec.ts`. O teste com três processos aprova dois espectadores, sai e volta três vezes sem aprovação adicional, recarrega o espectador e verifica revogação. Ele verifica quadros efetivamente reproduzidos e crescimento dos pacotes de áudio; depende dos canais públicos de descoberta e das permissões de captura locais.

A fila PCM do Windows é limitada a 120 ms; se houver sobrecarga, descarta áudio antigo e volta a 40 ms, em vez de reproduzir segundos de atraso. Pacotes de áudio presos no IPC por mais de 150 ms são descartados. Isso reduz uma fonte de atraso, mas não é uma garantia de latência total: rede, codificação, buffer do receptor e dispositivo de saída também influenciam. Em P2P o anfitrião envia uma cópia por espectador.

Gerar o instalador Windows:

```powershell
npm.cmd run build
```

O arquivo é criado em `artifacts/Infinity-Setup-0.9.6.exe`, junto de `latest.yml` e `.blockmap`. Os pacotes macOS são gerados pelo GitHub Actions ou num Mac com `npm run build:mac`.

## Publicar

```powershell
git push origin main
git tag v0.9.6
git push origin v0.9.6
```

O workflow **Build Infinity installers** gera Windows x64, macOS Intel e macOS Apple Silicon e publica os arquivos na Release. O workflow **Deploy Infinity website** publica a pasta `website/` no GitHub Pages.

O `appId` antigo e o identificador da rede P2P foram preservados intencionalmente para que usuários da versão Tela recebam a atualização e continuem encontrando as mesmas salas durante a transição.
