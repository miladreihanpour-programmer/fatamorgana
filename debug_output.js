import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

const OUTPUT_DIR = './output';

function checkFile(filename, sheetName = null) {
  const filepath = path.join(OUTPUT_DIR, filename);
  if (!fs.existsSync(filepath)) {
    console.log(`❌ ${filename} - NOT FOUND\n`);
    return null;
  }

  const wb = XLSX.readFile(filepath);
  const ws = sheetName ? wb.Sheets[sheetName] : wb.Sheets[Object.keys(wb.Sheets)[0]];
  const data = XLSX.utils.sheet_to_json(ws);
  
  console.log(`✓ ${filename} - ${data.length} rows`);
  
  return data;
}

console.log('📊 Analyzing Output Files\n');

// Check raw data files
console.log('=== RAW DATA ===');
const mantenimento = checkFile('shocapp_mantenimento.xlsx', 'Mantenimento');
const esaurito = checkFile('shocapp_esaurito.xlsx', 'Esaurito 7gg');
const storico = checkFile('shocapp_esaurito_storico.xlsx', 'Storico');

if (mantenimento) {
  console.log('  Sample entries:', mantenimento.slice(0, 3));
  console.log('  Total stock:', mantenimento.reduce((s, r) => s + (r.qty || 0), 0), 'vaschette\n');
}

if (esaurito) {
  console.log('  Sample entries:', esaurito.slice(0, 3));
  console.log('  Total sold 7d:', esaurito.reduce((s, r) => s + (r.qty || 0), 0), 'vaschette\n');
}

// Check decision file
console.log('=== DECISIONS (da_ordinare.xlsx) ===');
const decisions = checkFile('shocapp_da_ordinare.xlsx', 'Decisioni');

if (decisions) {
  const withOrder = decisions.filter(d => (d['Da Ordinare'] || 0) > 0);
  const totalOrder = decisions.reduce((s, d) => s + (d['Da Ordinare'] || 0), 0);
  
  console.log(`  Total rows: ${decisions.length}`);
  console.log(`  Rows with order > 0: ${withOrder.length}`);
  console.log(`  Total vaschette to order: ${totalOrder}\n`);
  
  console.log('  Top 10 orders:');
  decisions
    .sort((a, b) => (b['Da Ordinare'] || 0) - (a['Da Ordinare'] || 0))
    .slice(0, 10)
    .forEach((d, i) => {
      console.log(`    ${i + 1}. ${String(d.Gusto).padEnd(28)} | stock=${String(d.Scorta).padEnd(2)} sold7d=${String(d['Venduti 7gg']).padEnd(2)} → order=${d['Da Ordinare']}`);
    });
  
  console.log('\n  Rows with order = 0:');
  decisions
    .filter(d => (d['Da Ordinare'] || 0) === 0)
    .slice(0, 10)
    .forEach((d, i) => {
      console.log(`    ${i + 1}. ${String(d.Gusto).padEnd(28)} | stock=${d.Scorta} sold7d=${d['Venduti 7gg']} (${d.Motivo})`);
    });
}

console.log('\n=== SUMMARY ===');
if (decisions) {
  const noSalesNoStock = decisions.filter(d => d['Venduti 7gg'] === 0 && d.Scorta === 0);
  console.log(`⚠️  Flavors with 0 sales + 0 stock: ${noSalesNoStock.length}`);
  if (noSalesNoStock.length > 0) {
    console.log('  (These should have been filtered out!)');
    console.log('  Examples:', noSalesNoStock.slice(0, 3).map(d => d.Gusto).join(', '));
  }
}
