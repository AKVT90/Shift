# SHIFT — Personal Work Schedule

Web app (PWA) pensada para uso diário **no iPhone**: importa screenshots do calendário do Continente, reconhece dias/cores/trocas, deixa-te corrigir, guarda tudo no telemóvel e publica um calendário Apple com URL permanente (Cloudflare Worker).

## Publicar uma nova versão no GitHub Pages (a partir do Mac)
1. Substitui os ficheiros do repositório pelos desta pasta (inclui a pasta `vendor/`, o OCR, ~9 MB — tem de ir para o GitHub).
2. **Sobe a versão** em `version.js` (ex.: `2026.11.21-1`). É isto que faz o iPhone instalar a atualização.
3. `git add -A && git commit -m "SHIFT 2026.11.21-1" && git push` (ou arrasta os ficheiros para o repositório no site do GitHub).
4. Espera 1–2 min pelo Pages. No iPhone abre a app: aparece **«Nova versão disponível → Atualizar»**. Também podes ir a Definições → *Procurar atualizações*.
   - Os dados **não** são tocados por atualizações: vivem no armazenamento da app, não nos ficheiros.
   - A app vai sempre à rede primeiro (com cache só offline) e o service worker ignora a cache HTTP do GitHub Pages, por isso não fica presa numa versão antiga.

## Instalar no iPhone
Safari → abre o endereço do Pages → Partilhar → **Adicionar ao Ecrã Principal**.
⚠ No iOS a app instalada tem armazenamento **separado** do Safari. Se já usaste a SHIFT no Safari: Definições → *Guardar cópia de segurança*, instala, e na app instalada *Restaurar de um ficheiro*.

## Importar horários
Importar → *Escolher screenshots* (abre a biblioteca de Fotografias; podes escolher vários, de meses diferentes). O OCR corre no próprio iPhone com ficheiros alojados no repositório (`vendor/tesseract`), sem enviar imagens para lado nenhum e **sem depender de CDN**; na primeira utilização os ficheiros ficam em cache e passam a funcionar offline. Confere o preview (dias com **?** estão em dúvida), *Continuar*, vê as diferenças e guarda. Uma imagem inválida não cancela as restantes.

## Dados e cópias de segurança
- Tudo é gravado logo a cada alteração (localStorage) e espelhado em IndexedDB, com **cópias automáticas** diárias (7 dias) e uma cópia antes de cada restauro. Se os dados desaparecerem, a app oferece restaurar ao abrir; se o JSON ficar ilegível, o original é preservado.
- Definições → Dados: guardar cópia (partilha para Ficheiros/AirDrop), restaurar de ficheiro, ver/restaurar cópias automáticas. A app avisa se passarem 14 dias sem cópia.
- A cópia inclui horários, histórico, URL e token do calendário (para o URL de subscrição não mudar), **mas não a palavra-passe do Worker**.

## Calendário Apple (Cloudflare Worker)
O Worker (`worker/`) já está configurado com o binding `CAL`. Na app: Definições → URL do Worker, token (*Gerar*), palavra-passe → *Publicar agora*. Depois, cada alteração (editar um dia, importar, restaurar) volta a publicar automaticamente; se falhar (sem rede), fica **«por publicar»** e repete ao reabrir a app ou quando volta a rede. Os eventos têm UID fixo por dia: atualizam-se sem duplicar e os turnos removidos desaparecem. O iPhone é que decide quando refresca um calendário subscrito (normalmente em horas).

## Despertadores — limitação real
Uma web app **não pode criar alarmes no iPhone**. A SHIFT prepara as horas e entrega-as ao Atalho **SHIFT Alarms**, que cria os alarmes no Relógio. Os passos para criar o Atalho estão dentro da app (Despertadores → *Como configurar o Atalho*). Alarmes criados pelo Atalho tocam na **próxima** ocorrência de cada hora: envia na véspera do turno ou na manhã do dia; a app avisa quando o dia não coincide. A sequência padrão (07:20…08:00, de 5 em 5 min, 9 alarmes) pode ser enviada em *Sequência padrão*.

## Segurança
- Nenhuma palavra-passe nem segredo está no código. A palavra-passe de publicação é guardada só neste iPhone (chave própria, fora dos dados e das cópias) e no Cloudflare (`wrangler secret put SECRET`).
- O token do calendário é a «chave» do URL de leitura: quem o tiver lê o calendário. Não o partilhes.
- `.gitignore` exclui `.dev.vars`, `.wrangler/` e `node_modules/`.

## Testes (Mac)
`npm i pngjs jsdom playwright` e depois `node test/core.test.js`, `node test/ui.test.js`, `node test/worker.test.mjs`, `node test/e2e.js` (Chromium com perfil iPhone: OCR real, persistência, recuperação, fila de publicação, atualizações). `python3 test/gen.py` gera o screenshot sintético.
