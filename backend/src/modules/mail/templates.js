const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** One plain, mobile-friendly layout for every email. `button` is { label, url }. */
function layout({ title, lines, button, footer, brand = 'Orvia' }) {
  const paras = lines.map((l) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#1f2d2b">${l.html ?? esc(l)}</p>`).join('');
  const html = `<!doctype html><html><body style="margin:0;background:#eef4f3;padding:24px 12px;font-family:Segoe UI,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:14px;padding:28px">
<tr><td>
<p style="margin:0 0 18px;font-size:20px;font-weight:700;color:#0b3d3a">${esc(brand)}</p>
<h1 style="margin:0 0 14px;font-size:20px;color:#0b3d3a">${esc(title)}</h1>
${paras}
${button ? `<p style="margin:22px 0"><a href="${esc(button.url)}" style="background:#0b3d3a;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-size:15px;font-weight:600;display:inline-block">${esc(button.label)}</a></p>
<p style="margin:0 0 14px;font-size:12px;color:#6b7f7c;word-break:break-all">If the button does not work, copy this address into your browser:<br>${esc(button.url)}</p>` : ''}
<p style="margin:18px 0 0;font-size:12px;color:#6b7f7c">${esc(footer ?? 'Orvia pharmacy software')}</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = [title, '', ...lines.map((l) => l.text ?? l), ...(button ? ['', `${button.label}: ${button.url}`] : []), '', footer ?? 'Orvia pharmacy software'].join('\n');
  return { html, text };
}

export function inviteMail({ name, kind, shopName, url, days }) {
  const subject = kind === 'owner' ? `Set up your Orvia account for ${shopName}` : kind === 'staff' ? `You have been added to ${shopName} on Orvia` : 'You have been added to the Orvia team';
  const intro =
    kind === 'owner' ? `Your pharmacy ${shopName} is ready on Orvia.` : kind === 'staff' ? `You have been added to ${shopName} on Orvia.` : 'You have been added to the Orvia team.';
  return {
    subject,
    ...layout({
      title: `Welcome, ${name}`,
      lines: [intro, 'Choose a password to start using your account.', `This link works once and expires in ${days} days.`],
      button: { label: 'Set my password', url },
      footer: 'If you were not expecting this, you can ignore this email.',
    }),
  };
}

export function resetMail({ name, shopName, url }) {
  return {
    subject: 'Reset your Orvia password',
    ...layout({
      title: 'Reset your password',
      lines: [`Hello ${name}, we received a request to reset the password${shopName ? ` for your ${shopName} account` : ''}.`, 'This link works once and expires in 1 hour.'],
      button: { label: 'Choose a new password', url },
      footer: 'If you did not ask for this, ignore this email: your password stays as it is.',
    }),
  };
}

export function noticeMail({ name, what }) {
  return {
    subject: `Security notice: ${what}`,
    ...layout({
      title: what.charAt(0).toUpperCase() + what.slice(1),
      lines: [`Hello ${name}, this is a security notice: ${what}.`, 'If this was you, there is nothing to do. If it was not, reset your password straight away and tell your shop owner or the Orvia team.'],
    }),
  };
}

export function testMail() {
  return { subject: 'Orvia test email', ...layout({ title: 'Email is working', lines: ['This is a test message from your Orvia server. If you can read it, invitations and password resets will reach people.'] }) };
}

/** Subscription emails: invoice issued, reminder, overdue, payment received. */
export function billingMail({ kind, name, shopName, number, total, due, url, graceDays }) {
  const subject = { issued: `Invoice ${number} for ${shopName}`, reminder: `Reminder: invoice ${number} is due ${due}`, overdue: `Overdue: invoice ${number} for ${shopName}`, paid: `Payment received for ${number}` }[kind];
  const lines = {
    issued: [`Hello ${name}, your Orvia subscription invoice for ${shopName} is ready.`, `Amount: ${total} (including GST). Due: ${due}.`],
    reminder: [`Hello ${name}, invoice ${number} for ${shopName} (${total}) is due on ${due}.`, 'Please pay it to keep everything running without a break.'],
    overdue: [`Hello ${name}, invoice ${number} for ${shopName} (${total}) was due on ${due} and is still unpaid.`, `After ${graceDays} days of grace your shop switches to view-only until it is paid. Your data is safe.`],
    paid: [`Hello ${name}, we have received ${total} for invoice ${number}. Thank you!`, `Your subscription is active until ${due}.`],
  }[kind];
  return { subject, ...layout({ title: kind === 'paid' ? 'Payment received' : kind === 'issued' ? 'Your invoice' : 'Payment due', lines, button: { label: kind === 'paid' ? 'See my billing' : 'View and pay', url } }) };
}

/** A friendly note to a customer who owes the shop money. Goes out under the shop's name; replies reach the shop. */
export function customerReminderMail({ name, shopName, amount, phone, address }) {
  return {
    subject: `Payment reminder from ${shopName}`,
    ...layout({
      brand: shopName,
      title: 'A gentle reminder',
      lines: [
        `Hello ${name},`,
        `This is a reminder that ${amount} is pending with ${shopName}. Please pay it when you can.`,
        phone ? `You can call us on ${phone}.` : 'You can reply to this email.',
        address ? `${shopName}, ${address}` : '',
        'If you have already paid, please ignore this message and accept our thanks.',
      ].filter(Boolean),
      footer: `Sent on behalf of ${shopName} by Orvia pharmacy software.`,
    }),
  };
}

/** A friendly note to a regular customer whose medicines are about to run out. Goes out under the shop's name; replies reach the shop. */
export function customerRefillMail({ name, shopName, items, phone, address }) {
  const when = (i) => (i.daysLeft > 1 ? `will last until about ${i.due}` : i.daysLeft === 1 ? 'runs out tomorrow' : i.daysLeft === 0 ? 'runs out today' : `may have run out on ${i.due}`);
  return {
    subject: `Time to refill your medicines at ${shopName}`,
    ...layout({
      brand: shopName,
      title: 'Your medicines may be running out',
      lines: [
        `Hello ${name},`,
        'From what you bought last time, these may be finishing soon:',
        ...items.map((i) => ({ html: `<b>${esc(i.name)}</b>: ${esc(when(i))}`, text: `- ${i.name}: ${when(i)}` })),
        phone ? `Call us on ${phone} or visit the shop to refill, so you do not miss a dose.` : 'Reply to this email or visit the shop to refill, so you do not miss a dose.',
        address ? `${shopName}, ${address}` : '',
        'If you have already refilled, please ignore this message.',
      ].filter(Boolean),
      footer: `Sent on behalf of ${shopName} by Orvia pharmacy software.`,
    }),
  };
}

/** A purchase order to a supplier. Goes out under the shop's name; replies reach the person who sent it. */
export function purchaseOrderMail({ number, supplierName, shopName, outlet, deliverTo, phone, expectedOn, notes, lines }) {
  const dateText = expectedOn ? new Date(`${expectedOn}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '';
  return {
    subject: `Purchase order ${number} from ${shopName}`,
    ...layout({
      brand: shopName,
      title: `Purchase order ${number}`,
      lines: [
        `Hello ${supplierName},`,
        `Please send the following to ${shopName}${outlet ? ` (${outlet})` : ''}${deliverTo ? `, ${deliverTo}` : ''}:`,
        ...lines.map((l, i) => ({ html: `${i + 1}. <b>${esc(l.name)}</b>${l.manufacturer ? ` (${esc(l.manufacturer)})` : ''}: ${l.packs} pack${l.packs === 1 ? '' : 's'}`, text: `${i + 1}. ${l.name}${l.manufacturer ? ` (${l.manufacturer})` : ''}: ${l.packs} pack${l.packs === 1 ? '' : 's'}` })),
        dateText ? `We would like it by ${dateText}.` : '',
        notes ? `Note: ${notes}` : '',
        phone ? `Please confirm availability and rates. You can call us on ${phone} or reply to this email.` : 'Please confirm availability and rates by replying to this email.',
      ].filter(Boolean),
      footer: `Sent on behalf of ${shopName} by Orvia pharmacy software.`,
    }),
  };
}
