# SHIFT — Personal Work Schedule

Web app (PWA) para iPhone: importa screenshots do calendário do Continente, reconhece dias/cores/trocas, deixa-te corrigir e guardar, e exporta para o Calendário Apple. Tudo corre no teu iPhone; os dados ficam guardados localmente (funciona offline depois da primeira abertura).

## Pôr online (GitHub Pages)
1. Cria um repositório no GitHub e carrega **todos** os ficheiros desta pasta (exceto `test/` e `worker/`, que são opcionais).
2. *Settings → Pages → Deploy from a branch → `main` / `(root)`*.
3. No iPhone, abre `https://O-TEU-UTILIZADOR.github.io/NOME-DO-REPO/` no **Safari** → Partilhar → **Adicionar ao Ecrã Principal**.

## Como usar
- **Importar**: escolhe um ou mais screenshots → confere a leitura (dias com **?** estão em dúvida; toca para corrigir) → Continuar → vês o resumo de diferenças → Guardar.
- Importar o mesmo mês outra vez compara com o que existe; dias editados à mão **não** são substituídos a menos que os marques.
- **Histórico**: cada importação guarda o estado anterior do mês e podes restaurá-lo.
- **Calibrar cores**: as cores de referência são estimativas. Se o primeiro mês sair errado, corrige os dias no preview e carrega em *Calibrar cores com as minhas correções*; guardam-se nas definições.

## Calendário Apple
- **Exportar .ics** (Definições): abre no Calendário. Cada dia tem UID fixo, por isso voltar a importar atualiza em vez de duplicar.
- **URL permanente (subscrição)**: o GitHub Pages é estático e não consegue gerar um calendário dinâmico. Para isso há `worker/` (Cloudflare Workers + KV, gratuito):
  1. Na pasta `worker/`: `npx wrangler login` e depois `npx wrangler deploy` (mostra o URL `https://shift-calendar.<conta>.workers.dev`). O `wrangler.toml` já tem o binding `CAL` com o teu namespace.
  2. `npx wrangler secret put SECRET` (escreve a tua palavra-passe).
  3. Na app → Definições: URL do worker, **Gerar** token, palavra-passe → *Publicar agora*.
  4. No iPhone: Definições → Calendário → Contas → Adicionar conta → Outra → Adicionar calendário subscrito → cola o `webcal://…` mostrado na app.
  O URL não muda. A app republica sozinha depois de cada alteração; o iPhone é que decide quando refresca (normalmente em horas).

## Despertadores — limitação real
Uma web app **não pode** criar alarmes no iPhone (o AlarmKit só existe em apps nativas Swift). A alternativa que funciona: um **Atalho** do iOS.
1. App Atalhos → novo atalho chamado **SHIFT Alarmes** (ou o nome definido nas Definições).
2. Ações: *Receber Texto como entrada* → *Dividir Texto* (Novas linhas) → *Repetir com cada item* → dentro: *Obter datas da entrada* (item) → *Criar alarme* (hora = a data obtida).
3. Em *Despertadores*, o botão **Criar no iPhone** abre o Atalho com as horas do dia. A app não consegue saber se o Atalho correu: avisa antes de reenviar para evitar duplicados.
Cria os alarmes de um turno de cada vez; o Atalho não cancela alarmes antigos (apaga-os no Relógio se o turno mudar).

## OCR
Usa Tesseract.js (carregado da CDN na primeira importação, precisa de Internet). A deteção de grelha, cores e contornos tracejados é feita por código próprio (`core.js`), não por IA, e baseia-se na posição de cada dia. Nada é guardado sem confirmação.

## Testes
`node test/core.test.js`, `node test/ui.test.js`, `node test/worker.test.mjs` (precisam de `pngjs` e `jsdom`; `python3 test/gen.py` gera o screenshot sintético).
