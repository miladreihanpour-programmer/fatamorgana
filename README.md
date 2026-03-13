# Gelateria Extractor

Automated Node.js tool that logs into the Gelateria Fata Morgana tracking manager (SHOCAPP), scrapes inventory data via Playwright, and exports it as CSV, JSON, and Excel.

## Prerequisites

- **Node.js 18+**
- **npm**

## Setup

1. **Clone the repo and install dependencies:**

```bash
git clone git@github.com:saeedzns/gelateria-extractor.git
cd gelateria-extractor
npm install
```

2. **Install Playwright browser (first time only):**

```bash
npx playwright install chromium
```

3. **Create a `.env` file** in the project root with your credentials:

```
GELATERIA_USER=your_username
GELATERIA_PASS=your_password
```

## How to Run

```bash
npm run shocapp
```

or directly:

```bash
node src/shocappExtractor.js
```

The script will:
1. Log in to the tracking manager using Playwright
2. Fetch **Mantenimento** data (all time, status = Mantenimento)
3. Fetch **Esaurito** data (last 7 days, status = Esaurito)
4. Calculate **Da Ordinare** (reorder quantities) using: `Order = MAX(0, A + D - B)` where A = last week sales, B = current stock, D = safety stock (15% of A)
5. Fill the `Flavor_Inventory_Template.xlsx` with order quantities
6. Export everything to `output/`

## Output Files

All output is saved in the `output/` folder:

| File | Description |
|------|-------------|
| `shocapp_mantenimento_tutto.xlsx` | Current stock (Mantenimento) |
| `shocapp_esaurito_7giorni.xlsx` | Last 7 days sold out (Esaurito) |
| `shocapp_da_ordinare.xlsx` | Calculated reorder quantities |
| `shocapp_template_filled.xlsx` | Inventory template with order quantities filled in |
| `shocapp_report.xlsx` | Multi-sheet report (Inventario, Mantenimento, Esaurito, Da Ordinare) |
| `shocapp_all_formats.zip` | ZIP bundle containing XLSX, CSV, and JSON versions |

## Project Structure

```
gelateria-extractor/
  .env                          # Credentials (gitignored)
  .gitignore
  package.json
  README.md
  Flavor_Inventory_Template.xlsx  # Template for inventory orders
  output/                        # Generated output files
  src/
    shocappExtractor.js          # Main extractor + reorder logic
    exportData.js                # JSON and CSV export helpers
    logger.js                    # Structured logging
```

## GitHub Actions (Automated Weekly Run)

The repo includes a GitHub Actions workflow (`.github/workflows/weekly-extract.yml`) that runs automatically every **Sunday at 05:00 UTC**.

To run it manually: go to **Actions** > **Weekly SHOCAPP Extract** > **Run workflow**.

Required GitHub secrets:
- `GELATERIA_USER`
- `GELATERIA_PASS`
- `TELEGRAM_BOT_TOKEN`
- `EMAIL_USER`
- `EMAIL_PASS`

## Telegram Notifications

After each run, the two Excel files (`shocapp_template_filled.xlsx` and `shocapp_report.xlsx`) are automatically sent to a Telegram chat via the **fatamilad_bot**.

To set up:
1. Get the bot token from [@BotFather](https://t.me/BotFather)
2. Add `TELEGRAM_BOT_TOKEN` to your `.env` (local) or GitHub Secrets (CI)
3. The chat ID (`104393673`) is pre-configured

If the token is not set, the Telegram step is skipped with a warning.

## Telegram Bot On Demand

The separate 6-hour workflow starts the bot in interactive mode without auto-sending files. During that window you can:
- choose exactly which files to send
- send them to your current Telegram chat
- type one or more email addresses and send the selected files there
- type one or more Telegram numeric IDs and send the selected files there
- for Telegram channels, use `@channelusername`
- download or send the complete ZIP bundle with all formats

Available bot actions:
- `✅/⬜` toggle each file in the current selection
- `📨 Invia a questa chat`
- `📧 Invia a email`
- `👤 Invia a Telegram ID`
- `🧹 Pulisci selezione`
- `🛑 Ferma Bot`

Input format examples:
- Email: `a@example.com, b@example.com`
- Telegram users/groups: `104393673, -1001234567890`
- Telegram channel: `@my_channel_name`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GELATERIA_USER` | Login username |
| `GELATERIA_PASS` | Login password |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Telegram chat ID (default: `104393673`) |
| `EMAIL_USER` | Sender Gmail address |
| `EMAIL_PASS` | Gmail app password |
| `EMAIL_TO` | Comma-separated recipient emails |

## Security

- Credentials are stored in `.env` (local) or GitHub Secrets (CI) — never committed.
- `.env`, cookies, and session files are gitignored.

# Pull/Push

git add -A
git commit -m "Update"
git push