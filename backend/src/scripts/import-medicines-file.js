// Imports a medicine CSV into the master catalog with the same importer the provider panel uses.
//   npm run import:medicines -- "path/to/file.csv"           (dry run: shows what would happen)
//   npm run import:medicines -- "path/to/file.csv" --apply   (really imports)
// Optional defaults for supplier-style lists: --manufacturer="Name" --hsn=3004 --gst=5
import { readFile } from 'node:fs/promises';
import { connectDB, disconnectDB } from '../config/db.js';
import { Medicine } from '../modules/medicines/medicine.model.js';
import { importMedicines } from '../modules/medicines/medicine.service.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
if (!file) {
  console.error('Usage: npm run import:medicines -- <file.csv> [--apply] [--manufacturer=..] [--hsn=..] [--gst=..]');
  process.exit(1);
}
const apply = args.includes('--apply');

await connectDB();
await Medicine.syncIndexes();

const csv = await readFile(file, 'utf8');
const defaults = { manufacturer: flag('manufacturer'), hsn: flag('hsn'), gstPercent: flag('gst') ? Number(flag('gst')) : undefined };
const r = await importMedicines(csv, { dryRun: !apply, source: 'import', defaults });

console.log(apply ? 'IMPORT DONE' : 'DRY RUN (nothing saved)');
if (r.profile) console.log(`Format: ${r.profile.label}\nDefaults filled in: ${JSON.stringify(r.profile.defaults)}\nStatus of imported rows: ${r.profile.importedAs}`);
console.log(`Rows read: ${r.totalRows} | new: ${r.toCreate} | created: ${r.created} | duplicates: ${r.duplicates.length} | errors: ${r.errors.length}`);
for (const d of r.duplicates.slice(0, 15)) console.log(`  duplicate row ${d.row} (${d.name}): ${d.reason}`);
for (const e of r.errors.slice(0, 25)) console.log(`  error row ${e.row} (${e.name}): ${e.message}`);
if (r.errors.length > 25) console.log(`  ... and ${r.errors.length - 25} more errors`);
console.log('Catalog size now:', await Medicine.countDocuments());
await disconnectDB();
