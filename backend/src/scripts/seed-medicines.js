// Loads data/sample-medicines.csv into the master catalog through the same importer the provider panel uses.
// SAMPLE DATA ONLY: generic names, placeholder manufacturer, best-effort schedule/GST/HSN.
// Verify every row (especially schedule and GST) before relying on it in production.
import { readFile } from 'node:fs/promises';
import { connectDB, disconnectDB } from '../config/db.js';
import { Medicine } from '../modules/medicines/medicine.model.js';
import { importMedicines } from '../modules/medicines/medicine.service.js';

await connectDB();
await Medicine.syncIndexes();

const csv = await readFile(new URL('../../data/sample-medicines.csv', import.meta.url), 'utf8');
const result = await importMedicines(csv, { dryRun: false, source: 'sample' });

console.log(`Medicine catalog: ${result.created} added, ${result.duplicates.length} already present, ${result.errors.length} rejected.`);
for (const e of result.errors) console.log(`  row ${e.row} (${e.name}): ${e.message}`);
await disconnectDB();
