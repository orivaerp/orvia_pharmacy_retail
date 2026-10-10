/**
 * What the shop owner sees in "Activity": the audit events that belong to a shop, in plain words.
 * An event that is not listed here (plan changes, billing runs, medicine catalog work ...) is Orvia's own business and is not shown.
 * `text` gets the event's meta plus `names` (customer, supplier and product names looked up from the ids in it).
 */
const rs = (n) => (n === undefined || n === null ? '' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
const list = (a) => (Array.isArray(a) ? a.join(', ') : a ?? '');
const CHANGES = { name: 'name', phone: 'phone', email: 'email', address: 'address', gstin: 'GSTIN', drugLicenseNo: 'drug licence', lowStockDefault: 'low-stock level', creditLimit: 'udhaar limit', openingBalance: 'opening balance', role: 'role', branchIds: 'outlets', isActive: 'active status', code: 'code', city: 'city', state: 'state', pincode: 'pincode' };
const changed = (m) => (m.changes?.length ? ` (${m.changes.map((c) => CHANGES[c] ?? c).join(', ')})` : '');

export const AREAS = {
  bills: 'Bills',
  stock: 'Stock',
  purchases: 'Purchases',
  products: 'Products',
  money: 'Money',
  people: 'Customers and staff',
  settings: 'Settings',
  security: 'Sign-ins and security',
};

export const EVENTS = {
  // bills
  'sale.create': { area: 'bills', text: (m) => `Made bill ${m.number}, ${rs(m.grand)}` },
  'sale.return': { area: 'bills', text: (m) => `Took items back on bill ${m.sale}, refund ${rs(m.refund)} (${m.number})` },
  'sale.cancel': { area: 'bills', text: (m) => `Cancelled bill ${m.number}: ${m.reason}${m.refunds ? `. Refunded ${m.refunds}` : ''}` },
  'sale.share': { area: 'bills', text: (m) => `Sent bill ${m.number} to the customer as a link` },
  'sale.unshare': { area: 'bills', text: (m) => `Turned off the customer's link to bill ${m.number}` },
  'sale.refund.retry': { area: 'bills', text: (m) => `Tried the UPI refund again for ${m.number}` },
  // stock
  'stock.entry': { area: 'stock', text: (m) => `Added stock to ${m.outlet} (${m.type === 'OPENING' ? 'opening stock' : 'received'}, ${m.lines} item${m.lines === 1 ? '' : 's'}${m.reference ? `, ref ${m.reference}` : ''})` },
  'stock.adjust': { area: 'stock', text: (m) => `Adjusted stock in ${m.outlet}: ${String(m.reason ?? '').toLowerCase().replace(/_/g, ' ')} (${m.lines} batch${m.lines === 1 ? '' : 'es'})` },
  'stock.transfer': { area: 'stock', text: (m) => `Moved stock from ${m.from?.name ?? m.from} to ${m.to?.name ?? m.to} (${m.lines} batch${m.lines === 1 ? '' : 'es'})` },
  'stockcount.start': { area: 'stock', text: (m) => `Started stock count "${m.name}"` },
  'stockcount.submit': { area: 'stock', text: (m) => `Finished counting "${m.name}" (${m.counted} batches)` },
  'stockcount.cancel': { area: 'stock', text: (m) => `Cancelled stock count "${m.name}"` },
  'stockcount.apply': { area: 'stock', text: (m) => `Applied stock count "${m.name}": ${m.changed} batch${m.changed === 1 ? '' : 'es'} corrected, short ${rs(m.shortValue)}, extra ${rs(m.extraValue)}${m.uncountedAsZero ? ', uncounted batches written off' : ''}` },
  'import.stock': { area: 'stock', text: (m) => `Imported from Excel into ${m.outlet}: ${m.products} new product${m.products === 1 ? '' : 's'}, ${m.packs} packs${m.skipped ? `, ${m.skipped} row(s) skipped` : ''}` },
  // purchases
  'purchase.create': { area: 'purchases', text: (m) => `Booked purchase ${m.number} (supplier invoice ${m.invoiceNo}), ${rs(m.grand)}${m.order ? `, against order ${m.order}` : ''}` },
  'purchaseorder.create': { area: 'purchases', text: (m) => `Wrote purchase order ${m.number} to ${m.supplier} (${m.items} item${m.items === 1 ? '' : 's'})` },
  'purchaseorder.update': { area: 'purchases', text: (m) => `Changed purchase order ${m.number}` },
  'purchaseorder.send': { area: 'purchases', text: (m) => `Sent purchase order ${m.number} to ${m.supplier} (${m.via === 'email' ? 'email' : m.via === 'whatsapp' ? 'WhatsApp' : 'printed'})` },
  'purchaseorder.cancel': { area: 'purchases', text: (m) => `Cancelled purchase order ${m.number}: ${m.reason}` },
  'purchaseorder.close': { area: 'purchases', text: (m) => `Closed purchase order ${m.number} as short supplied: ${m.reason}` },
  'purchase.return': { area: 'purchases', text: (m) => `Sent stock back to a supplier (${m.number}), ${rs(m.total)}` },
  'supplier.create': { area: 'purchases', text: (m) => `Added supplier ${m.name}` },
  'supplier.update': { area: 'purchases', text: (m) => `Changed supplier ${m.name}${changed(m)}` },
  'supplier.payment': { area: 'purchases', text: (m, n) => `Paid ${n.supplier ?? 'a supplier'} ${rs(m.amount)}` },
  'import.suppliers': { area: 'purchases', text: (m) => `Imported suppliers from Excel: ${m.created} added, ${m.opening ? `${rs(m.opening)} owed` : 'no opening balance'}` },
  // products
  'product.add': { area: 'products', text: (m) => `Added ${m.added} product${m.added === 1 ? '' : 's'} from the catalog` },
  'product.custom': { area: 'products', text: (m) => `Created own product ${m.name}` },
  'product.update': { area: 'products', text: (m) => `Changed product ${m.name}${changed(m)}` },
  'product.barcode_add': { area: 'products', text: (m, n) => `Saved barcode ${m.barcode} on ${n.product ?? 'a product'}` },
  'product.barcode_generate': { area: 'products', text: (m, n) => `Made the shop's own barcode ${m.barcode} for ${n.product ?? 'a product'}` },
  'product.barcode_remove': { area: 'products', text: (m, n) => `Removed barcode ${m.barcode} from ${n.product ?? 'a product'}` },
  'stock.alert_default': { area: 'products', text: (m) => `Set the low-stock level to ${m.packs} packs` },
  // money
  'expense.create': { area: 'money', text: (m) => `Wrote down an expense: ${m.category}, ${rs(m.amount)} (${String(m.mode).toLowerCase()})` },
  'expense.void': { area: 'money', text: (m) => `Cancelled an expense: ${m.category}, ${rs(m.amount)}. Reason: ${m.reason}` },
  'cash.close': { area: 'money', text: (m) => `Closed the day ${m.date}: should be ${rs(m.expected)}, counted ${rs(m.counted)}, ${m.difference === 0 ? 'matched' : m.difference < 0 ? `short ${rs(-m.difference)}` : `extra ${rs(m.difference)}`}${m.withdrawn ? `, took out ${rs(m.withdrawn)}` : ''}${m.replaced ? ' (replaced an earlier count)' : ''}` },
  'customer.payment': { area: 'money', text: (m, n) => `Received ${rs(m.amount)} (${String(m.mode).toLowerCase()}) from ${n.customer ?? 'a customer'} against udhaar` },
  'payments.keys.set': { area: 'settings', text: (m) => `Saved the Razorpay keys (${m.mode ?? ''} mode)` },
  'payments.keys.remove': { area: 'settings', text: () => 'Removed the Razorpay keys' },
  // customers and staff
  'customer.create': { area: 'people', text: (m) => `Added customer ${m.name}` },
  'customer.update': { area: 'people', text: (m) => `Changed customer ${m.name}${changed(m)}` },
  'customer.reminder': { area: 'people', text: (m, n) => `Sent an udhaar reminder to ${n.customer ?? 'a customer'} (${rs(m.owes)})` },
  'refill.reminder': { area: 'people', text: (m, n) => `Sent a refill reminder (${m.channel === 'whatsapp' ? 'WhatsApp' : 'email'}) to ${n.customer ?? 'a customer'} for ${m.items} medicine${m.items === 1 ? '' : 's'}` },
  'refill.reminder.bulk': { area: 'people', text: (m) => `Sent refill reminders by email to everyone due: ${m.sent} sent${m.failed ? `, ${m.failed} failed` : ''}` },
  'refill.dismiss': { area: 'people', text: (m, n) => `Stopped refill reminders for ${n.customer ?? 'a customer'} about ${n.product ?? 'a medicine'}` },
  'customer.reminder.bulk': { area: 'people', text: (m) => `Sent udhaar reminders to everyone who owes: ${m.sent} sent${m.failed ? `, ${m.failed} failed` : ''}` },
  'import.customers': { area: 'people', text: (m) => `Imported customers from Excel: ${m.created} added${m.opening ? `, ${rs(m.opening)} udhaar brought in` : ''}` },
  'staff.create': { area: 'people', text: (m) => `Added staff ${m.email} as ${String(m.role ?? '').replace(/_/g, ' ')}` },
  'staff.update': { area: 'people', text: (m) => `Changed staff ${m.email}${changed(m)}` },
  'staff.deactivate': { area: 'people', text: (m) => `Switched off staff ${m.email}` },
  'staff.activate': { area: 'people', text: (m) => `Switched on staff ${m.email}` },
  'staff.reinvite': { area: 'people', text: () => 'Sent a staff member a new sign-in link' },
  // settings
  'shop.update': { area: 'settings', text: (m) => `Changed the shop details${changed(m)}` },
  'outlet.create': { area: 'settings', text: (m) => `Added outlet ${m.name}` },
  'outlet.update': { area: 'settings', text: (m) => `Changed outlet ${m.code}${changed(m)}` },
  'outlet.activate': { area: 'settings', text: (m) => `Switched on outlet ${m.code}` },
  'outlet.deactivate': { area: 'settings', text: (m) => `Switched off outlet ${m.code}` },
  'outlet.request': { area: 'settings', text: (m) => `Asked Orvia for ${m.count} more outlet${m.count === 1 ? '' : 's'}` },
  'outlet.create.by_provider': { area: 'settings', text: (m) => `Orvia added outlet ${m.name}` },
  'outlet.update.by_provider': { area: 'settings', text: (m) => `Orvia changed outlet ${m.code}` },
  'outlet.activate.by_provider': { area: 'settings', text: (m) => `Orvia switched on outlet ${m.code}` },
  'outlet.deactivate.by_provider': { area: 'settings', text: (m) => `Orvia switched off outlet ${m.code}` },
  'outlet.request.approve': { area: 'settings', text: (m) => `Orvia approved the outlet request (${m.granted} added)` },
  'outlet.request.reject': { area: 'settings', text: (m) => `Orvia declined the outlet request${m.note ? `: ${m.note}` : ''}` },
  // sign-ins and security
  'auth.login': { area: 'security', text: (m) => `Signed in${m.twoFactor ? ' (with the 2-step code)' : ''}` },
  'auth.2fa.enabled': { area: 'security', text: () => 'Turned on 2-step sign-in' },
  'auth.2fa.disabled': { area: 'security', text: () => 'Turned off 2-step sign-in' },
  'auth.2fa.recovery_codes': { area: 'security', text: () => 'Made new recovery codes' },
  'support.start': { area: 'security', text: (m) => `Orvia support opened your shop to look at your data (${m.minutes} minutes). Reason: ${m.reason}` },
  'support.end': { area: 'security', text: (m) => `Orvia support finished looking at your shop (${m.views ?? 0} pages viewed)` },
};

/** The action names that belong to the given area (or all shop actions). */
export const actionsIn = (area) => Object.entries(EVENTS).filter(([, e]) => !area || e.area === area).map(([a]) => a);
