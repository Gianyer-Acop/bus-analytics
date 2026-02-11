# Instruções para Deploy Manual no Render

## Passo 1: Commit e Push das Mudanças

```cmd
git add server.py
git commit -m "Migrate all database calls to PostgreSQL abstraction layer"
git push
```

## Passo 2: Aguardar Deploy Automático

O Render detecta automaticamente mudanças no GitHub e faz o redeploy:
1. Acesse https://dashboard.render.com
2. Clique no seu Web Service (`analise-onibus`)
3. Aguarde o status mudar para "Live" (verde) - leva ~2-3 minutos

## Passo 3: Configurar PostgreSQL (Se Ainda Não Fez)

### 3.1 Criar Banco PostgreSQL
1. No dashboard do Render, clique em **New +** → **PostgreSQL**
2. Preencha:
   - **Name:** `analise-onibus-db`
   - **Region:** Mesma do Web Service
   - **Instance Type:** **Free**
3. Clique em **Create Database**

### 3.2 Conectar ao Web Service
1. No painel do PostgreSQL, vá em **Info**
2. Copie a **Internal Database URL**
3. Vá para o Web Service → **Environment**
4. Adicione variável:
   - **Key:** `DATABASE_URL`
   - **Value:** Cole a URL copiada
5. Salve (vai fazer redeploy automático)

## Passo 4: Verificar Funcionamento

1. Acesse sua aplicação: `https://analise-onibus.onrender.com`
2. Faça login: `master` / `admin123`
3. Teste importar CSV
4. Teste exportar Excel
5. Aguarde 20 minutos e acesse novamente - os dados devem estar salvos! ✅

## Solução de Problemas

### Erro ao Importar CSV
- Verifique os logs do Render: **Logs** no menu lateral
- Procure por erros de conexão PostgreSQL

### Erro "No module named openpyxl"
- Aguarde o redeploy terminar completamente
- Verifique se `requirements.txt` tem `openpyxl`

### Dados Somem
- Confirme que `DATABASE_URL` está configurada
- Nos logs, procure por "Using PostgreSQL database"
