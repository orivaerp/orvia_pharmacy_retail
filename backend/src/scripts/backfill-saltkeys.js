// Computes the salt key (substitute grouping) for every catalog medicine that lacks one. Safe to re-run.
import { connectDB, disconnectDB } from '../config/db.js';
import { Medicine } from '../modules/medicines/medicine.model.js';
import { saltKeyOf } from '../modules/medicines/salt-key.js';

await connectDB();
const all = await Medicine.find().select('composition strength form saltKey').lean();
const ops = all
  .map((m) => ({ id: m._id, key: saltKeyOf(m), had: m.saltKey }))
  .filter((x) => x.key !== x.had)
  .map((x) => ({ updateOne: { filter: { _id: x.id }, update: x.key ? { $set: { saltKey: x.key } } : { $unset: { saltKey: '' } } } }));

if (ops.length) await Medicine.bulkWrite(ops, { ordered: false });
const groups = await Medicine.aggregate([{ $match: { saltKey: { $exists: true } } }, { $group: { _id: '$saltKey', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $count: 'groups' }]);
console.log(`Salt keys updated on ${ops.length} of ${all.length} medicines. Substitute groups (2+ medicines): ${groups[0]?.groups ?? 0}`);
await disconnectDB();
