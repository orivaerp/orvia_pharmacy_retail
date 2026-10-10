import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { env } from '../../config/env.js';
import { sendInviteMail } from '../mail/account-mail.js';

const inviteSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: Date,
  },
  { timestamps: true },
);

export const Invite = mongoose.model('Invite', inviteSchema);

export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const INVITE_DAYS = 7;
const RESET_HOURS = 1;

/** Creates a single-use "set your password" link. Only the hash is stored. Older open invites are voided. */
/** `reset` makes it a 1-hour password-reset link instead of a 7-day invitation. The link is also emailed (emailSent says if it was). */
export async function createInvite(user, { reset = false } = {}) {
  await Invite.deleteMany({ userId: user._id, usedAt: null });
  const token = crypto.randomBytes(32).toString('hex');
  await Invite.create({
    userId: user._id,
    tenantId: user.tenantId ?? undefined,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + (reset ? RESET_HOURS * 60 * 60 * 1000 : INVITE_DAYS * 24 * 60 * 60 * 1000)),
  });
  const url = `${env.FRONTEND_URL}/accept-invite?token=${token}`;
  const emailSent = await sendInviteMail(user, url, { reset, days: INVITE_DAYS });
  return { token, url, emailSent };
}
