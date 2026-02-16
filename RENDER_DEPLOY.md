# Guia de Deploy no Render

Este guia mostra como hospedar sua aplicação de análise de ônibus no **Render** (plataforma de hospedagem gratuita).

## Pré-requisitos
- Conta no GitHub (para versionar o código)
- Conta no Render (gratuita): https://render.com

---

## Passo 1: Preparar o Repositório no GitHub

### 1.1 Criar Repositório
1. Acesse https://github.com e faça login
2. Clique em **New Repository** (botão verde)
3. Nome do repositório: `analise-onibus` (ou o nome que preferir)
4. Deixe como **Private** se quiser que só você veja o código
5. Clique em **Create Repository**

### 1.2 Subir o Código
Abra o Prompt de Comando (CMD) na pasta do projeto e execute:

```cmd
git init
git add .
git commit -m "Initial commit - Analise de Onibus"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/analise-onibus.git
git push -u origin main
```

> [!NOTE]
> Substitua `SEU_USUARIO` pelo seu nome de usuário do GitHub.

> [!TIP]
> Se o `git` não estiver instalado, baixe em: https://git-scm.com/download/win

---

## Passo 2: Criar o Serviço no Render

### 2.1 Conectar GitHub
1. Acesse https://render.com e faça login
2. Clique em **New +** → **Web Service**
3. Conecte sua conta do GitHub (se ainda não conectou)
4. Selecione o repositório `analise-onibus`

### 2.2 Configurar o Serviço
Preencha os campos:

| Campo | Valor |
|-------|-------|
| **Name** | `analise-onibus` (ou qualquer nome) |
| **Region** | `Oregon (US West)` (ou o mais próximo) |
| **Branch** | `main` |
| **Root Directory** | (deixe em branco) |
| **Runtime** | `Python 3` |
| **Build Command** | `pip install -r requirements.txt` |
| **Start Command** | `python server.py` |

### 2.3 Plano Gratuito
- Em **Instance Type**, selecione: **Free**
- Clique em **Create Web Service**

---

## Passo 3: Aguardar o Deploy

O Render vai:
1. Instalar as dependências (`pandas`)
2. Iniciar o servidor
3. Gerar um link público (ex: `https://analise-onibus.onrender.com`)

> [!IMPORTANT]
> O primeiro deploy pode levar **5-10 minutos**. Aguarde até aparecer "Live" em verde.

---

## Passo 4: Acessar a Aplicação

1. Copie o link que aparece no topo da página (ex: `https://analise-onibus.onrender.com`)
2. **Compartilhe este link** com seus colegas
3. Eles podem acessar de **qualquer lugar** (não precisa estar na mesma rede)

### Credenciais de Acesso
*   **Usuário Master**: `master` / **Senha**: `admin123`
*   **Usuário Comum**: `user` / **Senha**: `user123`

---

## Observações Importantes

### ⚠️ Banco de Dados Temporário
O plano gratuito do Render **não mantém o banco de dados** quando o serviço reinicia. Isso significa:
- Os dados importados serão perdidos após ~15 minutos de inatividade
- Para persistência, você precisaria:
  - Usar um disco persistente (plano pago)
  - Ou conectar um banco externo (ex: PostgreSQL gratuito do Render)

### 🔄 Atualizações Automáticas
Sempre que você fizer `git push` no GitHub, o Render vai automaticamente atualizar a aplicação!

### 💤 Modo Sleep (Plano Gratuito)
- O serviço "dorme" após 15 minutos sem uso
- O primeiro acesso após dormir pode levar ~30 segundos para "acordar"

---

## Solução de Problemas

### Erro: "Application failed to respond"
- Verifique os **Logs** no painel do Render
- Certifique-se de que o `Start Command` está correto: `python server.py`

### Erro: "No module named 'pandas'"
- Verifique se o arquivo `requirements.txt` existe na raiz do projeto
- O `Build Command` deve ser: `pip install -r requirements.txt`

### Link não abre
- Aguarde o deploy terminar (status "Live" em verde)
- Verifique se não há erros nos Logs

---

## Próximos Passos (Opcional)

### Adicionar Persistência de Dados
Para manter os dados mesmo após reiniciar:
1. No painel do Render, vá em **Environment** → **Add Disk**
2. Monte em `/opt/render/project/src/data`
3. Atualize `server.py` para salvar o banco em `data/bus_analysis.db`

### Usar Domínio Personalizado
- Render permite conectar seu próprio domínio (ex: `analise.suaempresa.com`)
- Vá em **Settings** → **Custom Domain**
