# Fata Morgana — Deploy Completo (€0/mese)

## Come funziona

```
Chiunque preme "Avvia Estrazione" sull'app
              ↓
    Render.com riceve la richiesta
              ↓
    Attiva GitHub Actions (gratis, 7GB RAM)
              ↓
    Chrome gira nel cloud di GitHub
    Accede a SHOCAPP, legge l'inventario
    Calcola l'ordine, genera PDF
              ↓
    Risultati inviati a Render.com
              ↓
    App mostra Dashboard + PDF (4-5 minuti dopo)
```

**Costo totale: €0/mese**
**Requisiti: solo uno smartphone e internet**

---

## STEP 1 — Metti il codice su GitHub

Se non hai ancora un account GitHub: vai su **github.com** e registrati (gratis).

Poi nel terminale di VS Code:
```powershell
cd D:\fata
git init
git add .
git commit -m "Fata Morgana"
```

Su github.com → crea un nuovo repository chiamato `fata` (privato va benissimo).
Poi:
```powershell
git remote add origin https://github.com/TUO_USERNAME/fata.git
git push -u origin main
```

---

## STEP 2 — Aggiungi i segreti su GitHub

Su github.com → il tuo repo `fata` → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Aggiungi questi 3 segreti:

| Nome | Valore |
|------|--------|
| `GELATERIA_USER` | `storoma10` |
| `GELATERIA_PASS` | `crocevia` |
| `JWT_SECRET` | `inventati-una-stringa-lunga-es-fm2024secretkey99` |

(Il JWT_SECRET deve essere uguale a quello che metterai su Render nel prossimo step)

---

## STEP 3 — Crea il token GitHub per il server

Il server Render deve poter avviare i workflow GitHub.
Devi creare un token di accesso:

1. GitHub → il tuo profilo (in alto a destra) → **Settings**
2. Scorri in fondo → **Developer settings**
3. **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
4. Imposta:
   - Token name: `fata-morgana-server`
   - Expiration: **No expiration**
   - Repository access: **Only select repositories** → scegli `fata`
   - Permissions → **Actions** → Read and write
5. **Generate token** → copia il token (inizia con `github_pat_...`)

⚠️ Salvalo subito — non lo vedrai più!

---

## STEP 4 — Deploy su Render.com

1. Vai su **render.com** → crea account gratis (no carta di credito)
2. **New +** → **Web Service**
3. Collega GitHub → autorizza → scegli il repo `fata`
4. Configura:

| Campo | Valore |
|-------|--------|
| Name | `fata-morgana-api` |
| Runtime | `Node` |
| Build Command | `npm install` |
| Start Command | `node server/index.js` |
| Instance Type | **Free** |

5. Vai su **Environment Variables** → aggiungi:

| Key | Value |
|-----|-------|
| `GELATERIA_USER` | `storoma10` |
| `GELATERIA_PASS` | `crocevia` |
| `JWT_SECRET` | `stessa stringa di prima` |
| `GITHUB_TOKEN` | `github_pat_xxxx...` (il token del step 3) |
| `GITHUB_REPO` | `TUO_USERNAME/fata` |
| `RENDER_URL` | `https://fata-morgana-api.onrender.com` |

6. **Create Web Service** → aspetta 2-3 min
7. Copia il tuo URL: `https://fata-morgana-api.onrender.com`

---

## STEP 5 — Tieni Render sveglio (UptimeRobot, gratis)

Il piano free di Render dorme dopo 15 min di inattività.
UptimeRobot lo sveglia automaticamente ogni 5 minuti, gratis:

1. Vai su **uptimerobot.com** → crea account gratis
2. **Add New Monitor**:
   - Monitor Type: **HTTP(s)**
   - Friendly Name: `Fata Morgana`
   - URL: `https://fata-morgana-api.onrender.com/health`
   - Monitoring Interval: **5 minutes**
3. **Create Monitor**

Da ora il server è sempre attivo.

---

## STEP 6 — Aggiorna l'app con l'URL del server

In VS Code apri `D:\fata\fata-app\lib\api.ts` e cambia:
```typescript
export const API_BASE = 'https://fata-morgana-api.onrender.com';
```

---

## STEP 7 — Costruisci e distribuisci l'APK

```powershell
# Una volta sola:
npm install -g eas-cli
eas login   # crea account su expo.dev (gratis)

# Ogni volta che vuoi aggiornare l'app:
cd D:\fata\fata-app
eas build --platform android --profile preview
```

- Attendi **5-10 minuti** — la build avviene nel cloud
- Scarica l'APK dal link che ricevi
- **Condividi il link via WhatsApp** con i 20 lavoratori
- I lavoratori aprono il link → installano → accedono con `storoma10` / `crocevia`

Se appare "Installa da fonti sconosciute":
Settings → Sicurezza → Installa app sconosciute → Permetti

---

## Come funziona l'estrazione dall'app

1. Qualsiasi lavoratore preme **"Avvia Estrazione"** sull'app
2. L'app mostra: *"Estrazione avviata — pronta in 4-5 minuti"*
3. Possono chiudere l'app e tornare dopo 5 minuti
4. Il Dashboard si aggiorna automaticamente con i nuovi dati
5. Il PDF dell'ordine è pronto da scaricare

---

## Aggiornare il codice in futuro

Quando modifichi il codice su VS Code:
```powershell
cd D:\fata
git add .
git commit -m "aggiornamento"
git push
# Render si aggiorna automaticamente in 2-3 minuti
```

Per aggiornare l'app Android:
```powershell
cd D:\fata\fata-app
eas build --platform android --profile preview
# Condividi il nuovo APK via WhatsApp
```

---

## Riepilogo costi

| Servizio | Costo |
|----------|-------|
| GitHub (repo + Actions) | **Gratis** |
| Render.com (API server) | **Gratis** |
| UptimeRobot (keep-alive) | **Gratis** |
| EAS Build (APK) | **Gratis** |
| **TOTALE** | **€0/mese** |

---

## Risoluzione problemi

**"GitHub Actions non configurato"** → controlla che `GITHUB_TOKEN` e `GITHUB_REPO` siano in Render Environment Variables

**L'estrazione non parte** → vai su github.com → repo → Actions → controlla se il workflow è partito

**App dice "Nessun dato"** → esegui la prima estrazione dall'app (premi Avvia Estrazione)

**Render dorme (30 secondi di attesa)** → configura UptimeRobot come da Step 5
