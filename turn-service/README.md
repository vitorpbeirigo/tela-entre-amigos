# Infinity Network

Endpoint mínimo para gerar credenciais temporárias do Cloudflare Realtime TURN. As chaves administrativas ficam somente nas variáveis `TURN_KEY_ID` e `TURN_API_TOKEN` da Vercel.

Depois do deploy de produção, coloque a URL `https://SEU-PROJETO.vercel.app/api/turn` no campo `turnCredentialsUrl` do `network.json` na raiz do repositório.

O endpoint aceita o Infinity e clientes Tela antigos durante a transição, aplica um limite básico por IP, reutiliza a mesma credencial durante cinco minutos e gera credenciais que expiram após seis horas.
