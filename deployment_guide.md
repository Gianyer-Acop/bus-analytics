# Guia de Acesso na Rede Local (LAN)

Siga este guia para permitir que seus colegas acessem a ferramenta de análise de seus próprios computadores.

## Método Recomendado: Acesso Direto na Mesma Rede

### Passo 1: Inicie o Servidor
1. Execute o arquivo `start.bat`.
2. O console mostrará automaticamente o link de acesso:
   ```
   ==================================================
    Servidor rodando na rede local!
    Peça aos seus colegas para acessarem:
    http://192.168.1.XX:8000
   ==================================================
   ```
3. **Copie exatamente este link** que apareceu no seu console.

### Passo 2: Compartilhe o Link
1. Envie o link `http://192.168.1.XX:8000` para seus colegas via e-mail, Teams ou WhatsApp.
2. **Importante:** Seus colegas devem estar conectados na **mesma rede Wi-Fi ou cabo** que você.
3. Se não funcionar, veja a seção "Resolução de Problemas" abaixo.

### Credenciais de Acesso
Você pode fornecer os seguintes dados:
*   **Usuário Master**: `master` / **Senha**: `admin123` (Pode excluir dados e ações).
*   **Usuário Comum**: `user` / **Senha**: `user123` (Apenas visualização e comentários).

---

## Resolução de Problemas (Acesso Direto)

### Problema: "Não foi possível acessar o site" ou "Tempo limite esgotado"

**Solução 1: Liberar Porta no Firewall do Windows** (Requer permissão de administrador)
1. Abra o menu Iniciar e digite "Segurança do Windows".
2. Vá em **Firewall e proteção de rede** -> **Configurações avançadas**.
3. Clique em **Regras de Entrada** (lado esquerdo).
4. Clique em **Nova Regra...** (lado direito).
5. Escolha **Porta** e clique em Avançar.
6. Selecione **TCP** e em **Portas locais específicas** digite: `8000`.
7. Clique em Avançar até chegar ao nome.
8. Dê o nome: `Analise de Onibus - Porta 8000` e clique em Concluir.

**Solução 2: Peça ao administrador de TI**
Se você não tem permissão de administrador, peça ao suporte de TI para liberar a porta 8000 TCP (entrada) no seu computador.

---

## Alternativa Avançada: Acesso pela Internet (Sem Firewall)
**Use esta opção APENAS se:**
- Você não consegue liberar o Firewall (sem permissão de administrador)
- Seus colegas estão em redes diferentes (ex: home office)

> [!WARNING]
> Os serviços de túnel SSH gratuitos (serveo.net, localhost.run) frequentemente exigem chaves SSH ou ficam instáveis. **Recomendamos fortemente usar o método de Acesso Direto acima** pedindo ao administrador de TI para liberar a porta.

### Se ainda assim quiser tentar:

**Opção 1: Ngrok (Mais Estável)**
1. Baixe o Ngrok em: https://ngrok.com/download
2. Extraia o arquivo `ngrok.exe` para a pasta do projeto.
3. Com o `start.bat` rodando, abra um novo CMD e digite:
   ```cmd
   ngrok http 8000
   ```
4. Copie o link que aparecer (ex: `https://xxxx.ngrok-free.app`).

> [!NOTE]
> O Ngrok gratuito funciona sem cadastro, mas o link muda toda vez que você reinicia.

> [!TIP]
> **Se o comando pedir para "continuar conectando" (yes/no):** digite `yes` e dê Enter.
> Este link funcionará enquanto a janela do CMD com o comando SSH estiver aberta.

> [!NOTE]
> Se o colega encontrar uma tela pedindo senha ou IP, basta fornecer o seu IP público (que você vê no site `meuip.com.br`).

---
> [!IMPORTANT]
> O seu computador deve permanecer ligado e com o `start.bat` aberto para que seus colegas consigam acessar.
