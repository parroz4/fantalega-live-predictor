# Scheda Chrome Web Store – testi pronti da copiare

## Nome
Fantalega Live Predictor

## Descrizione breve (max 132 caratteri)
Proiezione del risultato dei match live della tua fantalega: voti, sostituzioni, modificatore difesa e fasce gol.

## Categoria / Lingua
Sport (oppure Strumenti) · Italiano

## Descrizione dettagliata
Segui il live della tua fantalega e scopri subito come finirebbe il match.

Fantalega Live Predictor aggiunge un pannello alle pagine live di Leghe Fantacalcio e calcola il risultato ipotizzando che chi deve ancora giocare prenda 6:

• Proiezione di punti e gol per entrambe le squadre, con le fasce gol della tua lega
• Dettaglio giocatore per giocatore: voti usciti, voti stimati, chi entra dalla panchina e al posto di chi
• Sostituzioni automatiche (pari ruolo e cambio modulo) con il numero massimo di cambi della lega
• Modificatore difesa con la tabella della lega, bonus porta inviolata, limita pareggio, limita vittoria, autogol, ammonito senza voto
• Le regole si leggono da sole: apri Opzioni di Lega e vengono salvate per quella lega
• Backup e ripristino delle impostazioni di tutte le leghe

Nessun dato personale raccolto: tutti i calcoli avvengono nel tuo browser.

Progetto indipendente, non affiliato né approvato da Fantacalcio S.r.l. Fantacalcio è un marchio dei rispettivi proprietari.

## Scheda "Privacy" (Developer Dashboard)
**Scopo unico (single purpose):**
Calcolare e mostrare la proiezione del risultato dei match live di una fantalega sulle pagine di leghe.fantacalcio.it.

**Giustificazione permesso `storage`:**
Salvare in locale (chrome.storage.sync) le regole di calcolo di ciascuna lega (fasce gol, modificatori, sostituzioni), così l'utente non deve reinserirle.

**Giustificazione host `https://leghe.fantacalcio.it/*` (content script):**
L'estensione legge voti e formazioni della pagina live e le impostazioni di lega per calcolare la proiezione direttamente nella pagina. Non funziona su altri siti.

**Codice remoto:** No, tutto il codice è incluso nel pacchetto.

**Dati raccolti:** nessuno (non spuntare alcuna categoria).
Certificazioni: spunta tutte e tre (non vendo dati a terzi; non li uso per scopi non correlati; non li uso per merito creditizio).

**URL informativa privacy:** link al file PRIVACY.md su GitHub (o pagina pubblica equivalente).

## Immagini
- Icona 128×128: `extension/icons/icon128.png`
- Screenshot 1280×800: `store/screenshots/1-proiezione.png`, `2-dettaglio.png`, `3-regole.png` (le squadre e i giocatori sono di fantasia)
- Riquadro promozionale 440×280: `store/promo-440x280.png`

## Passi per pubblicare
1. Vai su https://chrome.google.com/webstore/devconsole con il tuo account Google e paga la quota di registrazione una tantum.
2. "Nuovo elemento" → carica `fantalega-live-predictor-store.zip` (contiene `manifest.json` alla radice).
3. Compila la scheda con i testi qui sopra, carica icona/screenshot/promo.
4. Tab Privacy: copia scopo unico, giustificazioni, nessun dato raccolto, URL della privacy policy.
5. Visibilità: Pubblica (oppure "Non in elenco" per farla usare solo a chi ha il link, es. i compagni di lega).
6. Invia per la revisione.

## Aggiornamenti
Aumenta `version` in `manifest.json`, rifai lo zip della cartella `extension/` e caricalo come nuovo pacchetto.
