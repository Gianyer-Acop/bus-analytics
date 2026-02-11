# Guia: Migração para PostgreSQL no Render

Este guia mostra como configurar o PostgreSQL gratuito do Render para manter seus dados permanentemente.

## Por que PostgreSQL?
✅ **Dados Permanentes:** Não perde dados após inatividade  
✅ **Gratuito:** 90 dias de retenção no plano free  
✅ **Automático:** Backup e manutenção gerenciados pelo Render  

---

## Passo 1: Criar Banco PostgreSQL no Render

1. Acesse o [Dashboard do Render](https://dashboard.render.com)
2. Clique em **New +** → **PostgreSQL**
3. Preencha os campos:
   - **Name:** `analise-onibus-db`
   - **Database:** `analise_db` (nome do banco)
   - **User:** `analise_user` (nome do usuário)
   - **Region:** Mesma região do seu Web Service (ex: Oregon)
   - **PostgreSQL Version:** 16 (ou a mais recente)
   - **Instance Type:** **Free**
4. Clique em **Create Database**
5. Aguarde ~2 minutos até o status ficar "Available" (verde)

---

## Passo 2: Conectar ao Web Service

### 2.1 Copiar a URL de Conexão
1. No painel do PostgreSQL que você acabou de criar, vá em **Info**
2. Copie a **Internal Database URL** (começa com `postgresql://`)

### 2.2 Adicionar ao Web Service
1. Vá para o seu **Web Service** (`analise-onibus`)
2. Clique em **Environment** (menu lateral)
3. Clique em **Add Environment Variable**
4. Preencha:
   - **Key:** `DATABASE_URL`
   - **Value:** Cole a URL que você copiou
5. Clique em **Save Changes**

> [!IMPORTANT]
> O Render vai automaticamente fazer um **redeploy** quando você salvar. Aguarde o deploy terminar (~2-3 minutos).

---

## Passo 3: Verificar Funcionamento

1. Acesse sua aplicação (ex: `https://analise-onibus.onrender.com`)
2. Faça login com `master` / `admin123`
3. Importe alguns dados de teste
4. **Aguarde 20 minutos** (para o serviço "dormir")
5. Acesse novamente → Os dados devem estar lá! ✅

---

## Como Funciona

O código foi atualizado para:
- **Detectar automaticamente** se existe `DATABASE_URL` (PostgreSQL) ou não (SQLite)
- **Local (seu PC):** Usa SQLite (`bus_analysis.db`)
- **Render (nuvem):** Usa PostgreSQL (dados permanentes)

---

## Solução de Problemas

### Erro: "relation does not exist"
- O banco está vazio. Importe os dados novamente.
- As tabelas são criadas automaticamente no primeiro acesso.

### Erro: "could not connect to server"
- Verifique se a `DATABASE_URL` está correta
- Certifique-se de usar a **Internal Database URL**, não a External

### Dados ainda somem
- Confirme que a variável `DATABASE_URL` está configurada no Web Service
- Verifique os logs do Render para ver se está usando PostgreSQL

---

## Migrar Dados Existentes (Opcional)

Se você já tem dados no SQLite local e quer migrar:

1. **Exporte do SQLite:**
   ```cmd
   sqlite3 bus_analysis.db .dump > backup.sql
   ```

2. **Adapte o SQL** (PostgreSQL usa sintaxe ligeiramente diferente)
   - Remova linhas com `BEGIN TRANSACTION` e `COMMIT`
   - Substitua `AUTOINCREMENT` por `SERIAL`

3. **Importe no PostgreSQL:**
   - Use um cliente como [pgAdmin](https://www.pgadmin.org/) ou [DBeaver](https://dbeaver.io/)
   - Conecte usando a **External Database URL**
   - Execute o SQL adaptado

> [!TIP]
> Para a maioria dos casos, é mais fácil **reimportar os CSVs** diretamente na interface web após o deploy.
