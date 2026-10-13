import mongoose from 'mongoose';

/**
 * Addresses Orvia must not email again: they bounced for good (the mailbox does not exist) or the person marked a message as spam.
 * Amazon SES watches the bounce and complaint rate of the whole account; sending to these addresses again is what gets an account paused.
 * This list is for the whole platform (the SES account is shared by every shop).
 */
const suppressionSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    reason: { type: String, enum: ['bounce', 'complaint', 'manual'], required: true },
    detail: String, // for example the mail server's own words, or the kind of complaint
    count: { type: Number, default: 1 },
    lastAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
export const Suppression = mongoose.model('EmailSuppression', suppressionSchema);

/** What came back from SES, kept for the counts on the Email page. Not the message, just the event. */
const eventSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['bounce', 'complaint'], required: true },
    email: { type: String, lowercase: true },
    permanent: Boolean, // a bounce that will never work (not a full mailbox or a passing problem)
    subType: String,
    detail: String,
    messageId: String,
  },
  { timestamps: { createdAt: 'at', updatedAt: false } },
);
eventSchema.index({ at: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });
eventSchema.index({ type: 1, at: -1 });
export const MailEvent = mongoose.model('EmailEvent', eventSchema);

const norm = (e) => String(e ?? '').trim().toLowerCase();

export async function isSuppressed(email) {
  return Boolean(await Suppression.exists({ email: norm(email) }));
}

export async function suppress(email, reason, detail) {
  const e = norm(email);
  if (!e) return;
  await Suppression.updateOne({ email: e }, { $set: { reason, detail: detail?.slice(0, 300), lastAt: new Date() }, $inc: { count: 1 }, $setOnInsert: { email: e } }, { upsert: true });
}

/**
 * One notification from SES (the message inside an SNS notification).
 * A permanent bounce and any complaint stop all further mail to that address. A passing bounce (full mailbox, server busy) does not.
 * Returns what it did, for the log and the tests.
 */
export async function recordMailEvent(message) {
  const kind = message?.notificationType ?? message?.eventType;
  const done = [];
  if (kind === 'Bounce') {
    const b = message.bounce ?? {};
    const permanent = b.bounceType === 'Permanent';
    for (const r of b.bouncedRecipients ?? []) {
      await MailEvent.create({ type: 'bounce', email: r.emailAddress, permanent, subType: b.bounceSubType, detail: r.diagnosticCode?.slice(0, 300), messageId: message.mail?.messageId });
      if (permanent) await suppress(r.emailAddress, 'bounce', r.diagnosticCode ?? b.bounceSubType);
      done.push({ email: norm(r.emailAddress), suppressed: permanent });
    }
  } else if (kind === 'Complaint') {
    const c = message.complaint ?? {};
    for (const r of c.complainedRecipients ?? []) {
      await MailEvent.create({ type: 'complaint', email: r.emailAddress, subType: c.complaintFeedbackType, messageId: message.mail?.messageId });
      await suppress(r.emailAddress, 'complaint', c.complaintFeedbackType ?? 'spam complaint');
      done.push({ email: norm(r.emailAddress), suppressed: true });
    }
  }
  return done;
}
