# Infinity: conexão inicial, recuperação e atualização de dependências

O usuário autorizou atualizar todas as dependências estáveis, corrigir os caminhos de conexão e publicar para Windows/Mac com downloads atualizados. O terceiro amigo permanece isolado mesmo numa sala apenas com Gui; Greg e Gui também usam redes diferentes. O PC do amigo é cabeado e não foi possível testar outra rede.

## Resultado esperado

- Preservar salas, convites, identidade local, transmissões simultâneas, mosaico, qualidade ao vivo e áudio do Discord separado.
- Usar as versões estáveis atuais das dependências diretas, resolver vulnerabilidades aplicáveis e ajustar mudanças de API/build necessárias. Sem versões prerelease ou supressão de auditoria.
- Continuar com mídia P2P, sem TURN, SFU, conta paga ou servidor novo.
- Oferecer negociação incremental por Nostr e candidatos completos por MQTT/Torrent. Preservar STUN existentes e incluir somente endpoints públicos documentados.
- Recuperar tentativas iniciais que não entram em `getPeers()`, inclusive rotas silenciosas. Usar backoff e preservar rotas saudáveis: reabrir uma rota ocupada somente quando cada participante tiver outra conexão comprovadamente ativa. Reaberturas são sequenciais e revalidam a cobertura.
- Controlar falhas por rota e participante, evitando sobrescrita de erros de amigos diferentes ou restauração de erro já resolvido.
- Registrar diagnóstico dos transportes ainda pendentes, com estados e contagens/tipos de candidatos. Nunca registrar IP, porta, SDP, convite, senha, credencial, nomes de dispositivos ou estatísticas brutas.
- Permitir copiar um resumo seguro para investigar o computador que falha, sem exigir troca de rede ou comandos administrativos.

## Limites e evidência

O erro `direct` existente também pode ocorrer após erro de publicação/aplicação do SDP; ele não prova NAT como causa. A versão 0.10.1 só consulta PCs ativos para restartIce e evita qualquer reabertura de uma rota ocupada. Testes locais não comprovam conectividade entre todas as operadoras. A publicação precisa distinguir cobertura automatizada, builds Mac e validação posterior com o amigo afetado.

Mac permanece sem assinatura paga e com atualização manual; verificar requisitos mínimos do Electron atualizado. Nenhum processo do aplicativo em uso deve ser encerrado durante a investigação.
