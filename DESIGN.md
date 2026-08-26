# Tela — constelação entre amigos

Direção adaptada da referência “Your workplace has the answer. Just ask Dala for it.” fornecida para o projeto.

## Princípios

- Preto absoluto é o espaço do produto; hierarquia vem de escala, cor e respiro.
- Uma única ação preenchida por tela usa violeta `#8052ff`.
- Âmbar `#ffb829` identifica contexto, etapas e pequenos destaques.
- Títulos usam peso 400 e tracking negativo; corpo usa Inter variável em peso 200–300.
- Contêineres não devem parecer cartões empilhados. Vídeo e miniaturas podem ter raio de 24 px por serem conteúdo visual.
- A constelação triangular representa computadores encontrando uns aos outros sem um servidor de vídeo central.
- Estados humanos (“Conectado”, “Transmitindo”, “Procurando”) continuam acima dos detalhes técnicos.

## Tokens

| Papel | Valor |
| --- | --- |
| Canvas | `#000000` |
| Texto principal | `#ffffff` |
| Texto secundário | `#bdbdbd` |
| Texto discreto | `#9a9a9a` |
| Ação principal | `#8052ff` |
| Destaque | `#ffb829` |
| Profundidade cromática | `#15846e` |
| Erro | `#ff6f7d` |

## Forma, tipo e movimento

- Unidade base de 6 px e raios principais de 24 px.
- Títulos entre 42 e 92 px, peso 400, tracking `-0.04em`.
- Texto de apoio entre 15 e 18 px, peso 200–300.
- Botões primários em formato pill; ações secundárias como texto ou superfície fantasma.
- Partículas triangulares têm movimento lento e são desativadas com `prefers-reduced-motion`.
- Alvos interativos mantêm pelo menos 44 px e foco visível.

## Fluxo preservado

1. Escolher compartilhar ou assistir.
2. Selecionar fonte, qualidade e áudio.
3. Abrir a sala e copiar o convite.
4. Assistir, entrar em tela cheia ou encerrar.
