import { Tenant } from '../tenants/tenant.model.js';
import { sendMail } from './mailer.js';
import { inviteMail, noticeMail, resetMail } from './templates.js';

const shopNameOf = async (user) => (user.tenantId ? ((await Tenant.findById(user.tenantId).select('name').lean())?.name ?? 'your shop') : null);

/** Emails the "set your password" (or reset) link. Returns true if it was handed to the mail server. */
export async function sendInviteMail(user, url, { reset = false, days = 7 } = {}) {
  const shopName = await shopNameOf(user);
  const kind = !user.tenantId ? 'platform' : user.role === 'shop_owner' ? 'owner' : 'staff';
  const mail = reset ? resetMail({ name: user.name, shopName, url }) : inviteMail({ name: user.name, kind, shopName, url, days });
  const r = await sendMail({ to: user.email, subject: mail.subject, text: mail.text, html: mail.html, template: reset ? 'reset' : `invite-${kind}`, tenantId: user.tenantId });
  return r.sent;
}

/** A short "your account changed" heads-up (password changed, two-step verification turned off ...). */
export async function sendNotice(user, what) {
  const mail = noticeMail({ name: user.name, what });
  return (await sendMail({ to: user.email, subject: mail.subject, text: mail.text, html: mail.html, template: 'notice', tenantId: user.tenantId })).sent;
}
