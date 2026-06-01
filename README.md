# 🍦 Gelateria Fata Morgana — Extractor v2

Automated inventory tool: logs into SHOCAPP, calculates what to order, and sends you a ready-to-print PDF + Excel via Telegram — **zero manual editing required**.

---

## ⚡ Quick Setup (first time only)

### 1. Install Node.js dependencies
```
npm install
npx playwright install chromium
```

### 2. Install Python dependencies (for PDF generation)
```
pip install openpyxl reportlab
```

### 3. Create your `.env` file
Copy `.env.example` to `.env` and fill in your credentials:
```
GELATERIA_USER=your_shocapp_username
GELATERIA_PASS=your_shocapp_password
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
EMAIL_USER=your@gmail.com
EMAIL_PASS=your_app_password
EMAIL_TO=recipient@example.com
```

---

## 🚀 How to Run

### Start the Telegram Bot (recommended)
```
npm run bot
```
Then open Telegram, send `/start` to your bot, and use the buttons.

### Run extraction directly (no bot)
```
npm run extract
```

### Generate PDF only (from a filled Excel)
```
python src/excel_to_pdf.py gelato_flavors.xlsx output/ordine.pdf
```

---

## 🤖 Bot Buttons

| Button | What it does |
|--------|-------------|
| 🔄 **Estrai da SHOCAPP** | Logs in, scrapes inventory, calculates order, sends PDF + Excel automatically |
| 🧮 **Calcola Ordine Manuale** | Step through each flavour, type how many you have, bot calculates the order |
| 📁 **Invia File** | Pick which output files to send to Telegram |
| 📧 **Invia Email** | Send output files to any email address |
| 🛑 **Ferma Bot** | Stop the bot |

---

## 📐 Order Formula

```
Target = A + D
Da Ordinare = MAX(0, Target − B)
  A = last-week sales (Esaurito qty, last 7 days)
  D = safety stock    (15% of A, rounded up)
  B = current stock   (Mantenimento qty)
```

**Example:** Sold 7 last week, safety 2 (ceil 7×0.15), stock 5 → Order 4 (to reach target 9)

### Calcola Manuale targets
| Flavour | Target |
|---------|--------|
| MOUSSE | 20 |
| SUSHI GELATO | 8 |
| SUSHI MISTI / SUSHI TIRAMISU | 0 |
| Everything else | 2 |

---

## 📂 Output Files

All saved in `output/`:

| File | Description |
|------|-------------|
| `shocapp_da_ordinare.pdf` | ✅ Print-ready order sheet, 4-column landscape |
| `shocapp_template_filled.xlsx` | Excel template with order quantities filled in |
| `shocapp_da_ordinare.xlsx` | Order-only data (flavour, sold, stock, to-order) |
| `shocapp_mantenimento.xlsx` | Raw Mantenimento data from SHOCAPP |
| `shocapp_esaurito.xlsx` | Raw Esaurito (last 7 days) from SHOCAPP |

---

## 📁 Project Structure

```
fatamorgana/
  .env                     ← your credentials (never committed)
  .env.example             ← template
  .gitignore
  package.json
  gelato_flavors.xlsx      ← master flavour list + template
  output/                  ← generated files
  src/
    shocappExtractor.js    ← SHOCAPP scraper + order logic
    telegramBot.js         ← interactive bot
    generatePdf.js         ← Node PDF generator (pdfkit)
    excel_to_pdf.py        ← Python PDF generator (reportlab fallback)
    telegram.js            ← Telegram API helpers
    email.js               ← Gmail/nodemailer helpers
    logger.js              ← structured logging
```

---

## 🔐 Security

- Credentials are in `.env` only — never committed to git
- `.gitignore` excludes `.env`, `output/`, `node_modules/`
