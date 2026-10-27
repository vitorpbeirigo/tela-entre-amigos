# Salas permanentes de amigos

Proposta aprovada na conversa em 27/10/2026: sala salva, compartilhamentos simultâneos e mosaico; voz permanece no Discord.

## Comportamento

- Criar uma sala com nome e convite privado aleatório. Importar o convite uma vez salva a sala neste computador.
- Nome e identidade local persistem. A sala abre sem o criador conectado e sem aprovação repetida; possuir o convite autoriza o acesso.
- Uma transmissão por participante. Qualquer participante pode compartilhar e assistir às outras telas ao mesmo tempo.
- Assistir somente às telas escolhidas, até quatro no mosaico. Escolher foco e volume por tela; apenas o foco reproduz áudio.
- Sair da sala encerra captura, áudio e conexões locais, mas não apaga a sala nem encerra as transmissões dos amigos.
- Encerrar e reiniciar uma tela mantém a sala, o convite e os demais participantes.
- Qualidade inicial Jogar (720p30). Alteração de qualidade durante a transmissão não muda a sala.
- Convite não aparece em mensagens de descoberta nem logs. Dados locais inválidos geram orientação, não acesso a outra sala.

## Arquitetura e alternativas

Escolhida: reaproveitar Electron, captura/filtro de áudio e Trystero P2P. Presença e pedidos de vídeo trafegam por conexões de dados; mídia só é enviada ao espectador interessado, por uma rota de descoberta de cada vez.

Servidor central de vídeo foi descartado porque acrescenta infraestrutura e tráfego pagos. Banco de membros foi descartado nesta primeira versão: o convite privado e armazenamento local atendem à turma.

O acesso por convite é compartilhado: quem o receber pode entrar. Excluir uma sala localmente não revoga cópias de outros amigos. Reinstalação/limpeza dos dados pode exigir importar o convite novamente.

## Decisões de implementação

- Manter modo de transmissão temporária por código para compatibilidade; destacar Salas de amigos na home.
- Identificador de sala e segredo independentes, gerados com Web Crypto. Identidade local é identificação de interface, não prova de autoridade administrativa.
- Manter as estratégias atuais de descoberta e deduplicar vídeo entre elas. Sem servidor novo, dependência nova ou alteração de firewall adicional.
- Enquanto compartilha, silenciar reprodução das outras telas neste computador para não recapturar o áudio do Infinity. Windows mantém filtro do Discord; no Mac, mostrar aviso e opção de compartilhar sem áudio do sistema.
- Falha de P2P continua possível em redes restritas. Não prometer conectividade universal.
- Implementação e instalador local nesta tarefa; nova publicação requer pedido de release.

## Aceitação

Persistência após reload/reabertura; sala funciona sem criador; três participantes, dois compartilhando e terceiro assistindo a ambos; foco único de áudio; parar/voltar a assistir e compartilhar; reconexão sem convite; ausência de envios extras por estratégia; liberação da captura e helper ao sair; layout utilizável no tamanho mínimo do app. Fluxo antigo continua passando nos testes.
