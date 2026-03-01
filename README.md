# Privadao

Site de conteudo exclusivo com verificacao de compra via email.

**Dominio:** `privadao.com` (sem www)
**VPS:** Hostinger KVM 2 (2 vCPU, 8GB RAM, 100GB SSD) — Ubuntu 24.04 LTS
**IP:** `187.77.59.240`
**SSH:** `ssh root@187.77.59.240`

---

## Estrutura do projeto

```
privadaovps/
├── server.js            # Backend Express (porta 3000)
├── package.json         # Dependencias Node.js
├── nginx.conf           # Config Nginx (referencia local)
├── deploy.sh            # Script de deploy rapido (via SSH)
├── index.html           # Pagina publica (login com email)
├── obrigado/
│   └── index.html       # Pagina protegida (conteudo exclusivo)
├── images/              # Fotos e videos (~205MB)
├── css/                 # Estilos
├── js/                  # Scripts frontend
├── .env                 # Variaveis de ambiente (NAO commitar)
└── .gitignore
```

---

## Deploy rapido (atualizacoes do dia a dia)

### Opcao 1: Script automatico

```bash
# 1. Faca suas alteracoes
# 2. Commit
git add .
git commit -m "descricao da alteracao"

# 3. Deploy com um comando
./deploy.sh
```

O script faz tudo automaticamente:
- Push para o repositorio `deploy`
- Conecta na VPS via SSH
- Atualiza o codigo (`git pull`)
- Instala dependencias se necessario
- Reinicia a aplicacao

**Zero downtime. SSL preservado. ~10 segundos.**

### Opcao 2: Manual

```bash
# Push
git push deploy main

# Conecta e atualiza
ssh root@187.77.59.240 "cd /opt/privadao && git pull origin main && npm ci --omit=dev && pm2 restart privadao"
```

### Opcao 3: Via Cursor (pedir ao agente)

Diga: *"faca deploy na VPS"* — o agente executa o SSH automaticamente.

---

## Quando recriar a VPS (raro)

Recriar so e necessario se:
- Trocar de sistema operacional
- VPS corrompida ou inacessivel
- Mudar configuracao do Nginx drasticamente
- Trocar versao do Node.js

```
Hostinger MCP:
  VPS_recreateVirtualMachineV1:
    virtualMachineId: 1430682
    template_id: 1077
    post_install_script_id: 2968
```

> AVISO: Recriar apaga tudo (incluindo SSL). Limite de 4x por semana para evitar rate limit do Let's Encrypt.

---

## Repositorios Git

| Remote   | URL                                              | Uso                              |
|----------|--------------------------------------------------|----------------------------------|
| `origin` | `git@github.com:mklcorporate/privadao.git`       | Repo principal (desenvolvimento) |
| `deploy` | `git@github.com:mklcorporate/privadao-deploy.git` | **Usado pela VPS (producao)**    |
| `vps`    | `git@github.com:mklcorporate/privadao-vps.git`    | Backup/historico                 |

> A VPS clona do remote `deploy`. Sempre faca push para `deploy` antes de atualizar.

---

## Acessando a VPS

```bash
ssh root@187.77.59.240
```

### Comandos uteis na VPS

```bash
# Ver logs da aplicacao
pm2 logs privadao

# Reiniciar aplicacao
pm2 restart privadao

# Status da aplicacao
pm2 status

# Ver config do Nginx
cat /etc/nginx/sites-available/privadao

# Testar config do Nginx
nginx -t

# Recarregar Nginx (sem downtime)
systemctl reload nginx

# Ver log do setup inicial
cat /var/log/privadao-setup.log

# Ver log do certbot retry
cat /var/log/certbot-retry.log

# Status do SSL
certbot certificates
```

---

## SSL / HTTPS

- **Provedor:** Let's Encrypt (certbot + plugin nginx)
- **Dominio:** `privadao.com` (sem www)
- **Renovacao:** Cron automatico todo dia as 3h
- **Fallback:** Certificado auto-assinado caso Let's Encrypt falhe
- **Retry:** Cron a cada 6h se o cert inicial falhar

### Evitar problemas de SSL

- NAO recrie a VPS mais de 4x por semana
- Use `./deploy.sh` para atualizacoes (preserva o SSL)
- Se o SSL parar, o cron resolve sozinho em ate 6h

---

## Variaveis de ambiente

| Variavel                  | Descricao                                       |
|---------------------------|-------------------------------------------------|
| `PORT`                    | Porta do Express (3000)                          |
| `JWT_SECRET`              | Chave para assinar tokens de sessao              |
| `PERFECTPAY_TOKEN`        | Token API PerfectPay                             |
| `CAKTO_CLIENT_ID`         | Client ID OAuth Cakto                            |
| `CAKTO_CLIENT_SECRET`     | Client Secret OAuth Cakto                        |
| `DATABASE_URL`            | PostgreSQL Neon (tabela `compradores`)            |
| `KIRVANO_WEBHOOK_SECRET`  | Secret webhook Kirvano                           |
| `MANGOFY_API_KEY`         | API Key Mangofy                                  |
| `MANGOFY_STORE_CODE`      | Store Code Mangofy                               |

> Credenciais estao no `.env` local e no post-install script (ID 2968) da Hostinger.
> Para alterar na VPS sem recriar: `ssh root@187.77.59.240 "nano /opt/privadao/.env"` e depois `pm2 restart privadao`.

---

## Rotas da API

| Metodo | Rota                       | Descricao                                     |
|--------|----------------------------|-----------------------------------------------|
| POST   | `/api/verificar-email`     | Verifica email em Cakto + PerfectPay + DB      |
| GET    | `/api/diagnostico`         | Status das integracoes (debug)                 |
| POST   | `/api/diagnostico-email`   | Testa verificacao de email especifico           |
| POST   | `/api/webhook-kirvano`     | Webhook Kirvano (registra/remove compradores)   |
| POST   | `/api/webhook-mangofy`     | Webhook Mangofy (registra/remove compradores)   |
| GET    | `/api/logout`              | Limpa cookie de sessao                         |

---

## Atualizando fotos/videos

1. Adicione/remova arquivos na pasta `images/`
2. Edite `obrigado/index.html` para referenciar os novos arquivos
3. Formatos aceitos: **JPG, PNG, GIF, WebP, MP4**
4. **NAO use:** HEIC, MOV (incompativeis com browsers)
5. Converter MOV para MP4: `ffmpeg -i video.MOV -c:v libx264 -c:a aac video.mp4`
6. Rode `./deploy.sh`

---

## Dominios

| Dominio           | Uso                              |
|-------------------|----------------------------------|
| `privadao.com`    | Site principal (VPS Hostinger)    |
| `privadao.com.br` | Checkout Mangofy (nao mexer)      |

---

## IDs Hostinger MCP

| Recurso                | ID       |
|------------------------|----------|
| VPS Virtual Machine    | 1430682  |
| Template Ubuntu 24.04  | 1077     |
| Post-install Script    | 2968     |
| SSH Key                | 446354   |

---

## Troubleshooting

| Problema                    | Solucao                                                        |
|-----------------------------|----------------------------------------------------------------|
| Site "nao seguro"           | Cron retry resolve em ate 6h. Ou: `ssh root@187.77.59.240 "certbot --nginx -d privadao.com --non-interactive --agree-tos --email admin@privadao.com --redirect"` |
| Site lento                  | Imagens muito grandes? Otimize. Nginx ja serve static com cache |
| Erro 502 Bad Gateway        | Node caiu. `ssh root@187.77.59.240 "pm2 restart privadao"`     |
| Webhook nao funciona        | Verifique: `https://privadao.com/api/diagnostico`               |
| Email nao encontrado        | Teste: `curl -X POST https://privadao.com/api/diagnostico-email -H "Content-Type: application/json" -d '{"email":"teste@email.com"}'` |
| SSH recusado                | Chave SSH pode ter sido perdida (VPS recriada). Recriar com post-install script restaura. |
| deploy.sh nao funciona      | Verifique SSH: `ssh root@187.77.59.240 "echo ok"`              |
