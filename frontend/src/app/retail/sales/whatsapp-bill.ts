import { apiError } from '../../shared/utils/api';
import { SalesApi } from './sales-api.service';

const tenDigits = (v: string | null | undefined) => {
  const d = String(v ?? '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? d : '';
};

/**
 * Opens WhatsApp with the customer's bill link already typed, on the owner's own WhatsApp (nothing is sent until they press send there).
 * The window is opened straight away, while the click still counts, and pointed at WhatsApp once the link is ready; otherwise a browser
 * would block it as a pop-up. A customer without a phone number on the bill is asked for one.
 */
export function sendBillOnWhatsApp(api: SalesApi, saleId: string, onError: (message: string) => void, onDone?: () => void) {
  const w = window.open('', '_blank');
  if (!w) return onError('The browser blocked the WhatsApp window. Allow pop-ups for this site and try again.');
  w.document.write('<p style="font:14px system-ui;padding:16px">Opening WhatsApp…</p>');
  api.share(saleId).subscribe({
    next: (r) => {
      let phone = tenDigits(r.phone);
      if (!phone) {
        phone = tenDigits(prompt('This bill has no phone number. Customer’s mobile number (10 digits):'));
        if (!phone) {
          w.close();
          return;
        }
      }
      const date = new Date(r.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
      const text = [
        `Hello${r.customerName ? ' ' + r.customerName : ''},`,
        `Thank you for shopping at ${r.shopName || 'our pharmacy'}.`,
        `Your bill ${r.number} dated ${date}, ₹${r.total.toLocaleString('en-IN', { maximumFractionDigits: 2 })}:`,
        r.url,
        r.shopPhone ? `For any question call ${r.shopPhone}.` : '',
      ]
        .filter(Boolean)
        .join('\n');
      w.location.href = `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`;
      onDone?.();
    },
    error: (e) => {
      w.close();
      onError(apiError(e));
    },
  });
}
