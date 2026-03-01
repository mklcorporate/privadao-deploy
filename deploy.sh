#!/bin/bash
set -e

VPS_IP="187.77.59.240"
VPS_USER="root"
VPS_PATH="/opt/privadao"
DEPLOY_REMOTE="deploy"
BRANCH="main"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo -e "${YELLOW}=== Privadao Deploy ===${NC}"
echo ""

# 1. Verifica se tem alteracoes nao commitadas
if [[ -n $(git status --porcelain) ]]; then
    echo -e "${RED}Existem alteracoes nao commitadas.${NC}"
    echo "Faca commit antes de rodar o deploy:"
    echo "  git add ."
    echo "  git commit -m \"sua mensagem\""
    exit 1
fi

# 2. Push para o remote deploy
echo -e "${YELLOW}[1/4]${NC} Push para remote deploy..."
git push $DEPLOY_REMOTE $BRANCH
echo -e "${GREEN}  OK${NC}"

# 3. Conecta na VPS e atualiza
echo -e "${YELLOW}[2/4]${NC} Conectando na VPS e atualizando codigo..."
ssh -o StrictHostKeyChecking=no $VPS_USER@$VPS_IP "cd $VPS_PATH && git pull origin main" 2>&1
echo -e "${GREEN}  OK${NC}"

# 4. Instala dependencias se package.json mudou
echo -e "${YELLOW}[3/4]${NC} Verificando dependencias..."
ssh -o StrictHostKeyChecking=no $VPS_USER@$VPS_IP "cd $VPS_PATH && npm ci --omit=dev 2>&1 | tail -1"
echo -e "${GREEN}  OK${NC}"

# 5. Reinicia a aplicacao
echo -e "${YELLOW}[4/4]${NC} Reiniciando aplicacao..."
ssh -o StrictHostKeyChecking=no $VPS_USER@$VPS_IP "cd $VPS_PATH && pm2 restart privadao && pm2 save" 2>&1
echo -e "${GREEN}  OK${NC}"

echo ""
echo -e "${GREEN}=== Deploy concluido com sucesso! ===${NC}"
echo -e "Site: https://privadao.com"
echo ""
