import mongoose from 'mongoose';

// Append-only: there are no update/delete paths for this collection in the API.
const auditSchema = new mongoose.Schema(
  {
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    action: { type: String, required: true, index: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },
    meta: mongoose.Schema.Types.Mixed,
    ip: String,
  },
  { timestamps: { createdAt: 'at', updatedAt: false } },
);

export const AuditLog = mongoose.model('AuditLog', auditSchema);

/** For events with no signed-in request yet (a login). Never throws. */
export async function auditEvent({ actorId, action, tenantId, meta, ip }) {
  try {
    await AuditLog.create({ actorId, action, tenantId: tenantId ?? undefined, meta, ip });
  } catch (err) {
    console.error('audit write failed', err);
  }
}

/** Records who did what. Never throws: a failed audit write must not break the action itself. */
export async function audit(req, action, tenantId, meta) {
  try {
    await AuditLog.create({ actorId: req.user?.id, action, tenantId, meta, ip: req.ip });
  } catch (err) {
    console.error('audit write failed', err);
  }
}
