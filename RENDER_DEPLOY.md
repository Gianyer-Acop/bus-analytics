# Guia de Deploy no Render

Este guia mostra como fazer o deploy da aplicação de Análise de Ônibus no Render (hospedagem gratuita na nuvem).

## Pré-requisitos
- Conta no GitHub (para versionar o código)
- Conta no Render (gratuita): https://render.com

## Passo 1: Preparar o Repositório Git

### 1.1 Inicializar Git (se ainda não fez)
```cmd
cd c:\Users\cco05\Desktop\Gianyer\Analise
git init
git add .
git commit -m "Initial commit - Bus Analysis App"
```

### 1.2 Criar Repositório no GitHub
1. Acesse https://github.com/new
2. Nome do repositório: `analise-onibus` (ou outro nome)
3. **NÃO** inicialize com README
4. Clique em "Create repository"

### 1.3 Enviar Código para o GitHub
```cmd
git remote add origin https://github.com/SEU_USUARIO/analise-onibus.git
git branch -M main
git push -u origin main
```

## Passo 2: Criar Serviço no Render

### 2.1 Conectar GitHub ao Render
1. Acesse https://dashboard.render.com
2. Clique em "New +" → "Blueprint"
3. Conecte sua conta do GitHub
4. Selecione o repositório `analise-onibus`

### 2.2 Configuração Automática
O Render vai detectar automaticamente o arquivo `render.yaml` e criar:
- ✅ Um **Web Service** (servidor Python)
- ✅ Um **PostgreSQL Database** (banco de dados)

### 2.3 Aguarde o Deploy
- O primeiro deploy leva ~5-10 minutos
- Você verá os logs em tempo real
- Quando aparecer "Live" em verde, está pronto!

## Passo 3: Acessar a Aplicação

### 3.1 Obter URL
1. No dashboard do Render, clique no seu serviço
2. Copie a URL (ex: `https://analise-onibus.onrender.com`)
3. **Compartilhe este link** com seus colegas!

### 3.2 Credenciais
Use as mesmas credenciais de antes:
- **Master**: `master` / `admin123`
- **Comum**: `user` / `user123`

## Passo 4: Importar Dados Existentes (Opcional)

Se você já tem dados no SQLite local e quer migrar para o Render:

### 4.1 Exportar Dados Locais
```cmd
python migrate_export.py
```
(Isso criará arquivos CSV na pasta `exports/`)

### 4.2 Importar no Render
1. Acesse a aplicação no Render
2. Faça login como `master`
3. Use a interface de importação para enviar os CSVs

## Observações Importantes

> [!IMPORTANT]
> **Plano Gratuito do Render:**
> - O servidor "dorme" após 15 minutos de inatividade
> - O primeiro acesso após dormir leva ~30 segundos para "acordar"
> - Banco de dados PostgreSQL gratuito tem limite de 1GB
> - Perfeito para uso interno da equipe!

> [!TIP]
> **Atualizações Automáticas:**
> Sempre que você fizer `git push` no GitHub, o Render automaticamente atualiza a aplicação!

## Resolução de Problemas

### Erro: "Application failed to respond"
- Verifique os logs no dashboard do Render
- Geralmente é problema de porta ou variável de ambiente

### Erro: "Database connection failed"
- Verifique se o PostgreSQL foi criado corretamente
- Confirme que a variável `DATABASE_URL` está configurada

### Uploads não funcionam
- O Render não persiste arquivos no disco (sistema efêmero)
- Considere usar um serviço de storage como Cloudinary ou AWS S3 para uploads permanentes

## Próximos Passos (Opcional)

- **Domínio Personalizado**: Configure um domínio próprio (ex: `analise.suaempresa.com`)
- **Upgrade para Plano Pago**: Remove o "sleep" e aumenta limites ($7/mês)
- **Monitoramento**: Configure alertas de uptime
