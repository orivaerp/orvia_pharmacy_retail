/** Razorpay Checkout, loaded once on first use. */
export interface CheckoutResult {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open(): void; on(ev: string, fn: (r: { error?: { description?: string } }) => void): void };
  }
}

let script: Promise<void> | null = null;

export function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  script ??= new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = 'https://checkout.razorpay.com/v1/checkout.js';
    el.onload = () => resolve();
    el.onerror = () => {
      script = null;
      reject(new Error('Could not load the payment window. Check the internet connection.'));
    };
    document.head.appendChild(el);
  });
  return script;
}

/** Opens Checkout for an order. Resolves with the payment details, or null if the person closed it. Rejects if the payment failed. */
export async function payWithCheckout(order: { keyId: string; orderId: string; amountPaise: number; name: string; description: string }, prefill?: { name?: string; email?: string }): Promise<CheckoutResult | null> {
  await loadCheckout();
  return new Promise((resolve, reject) => {
    const rz = new window.Razorpay!({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amountPaise,
      currency: 'INR',
      name: order.name,
      description: order.description,
      theme: { color: '#0b3d3a' },
      prefill,
      modal: { ondismiss: () => resolve(null) },
      handler: (r: CheckoutResult) => resolve(r),
    });
    rz.on('payment.failed', (r) => reject(new Error(r.error?.description ?? 'The payment failed. Please try again.')));
    rz.open();
  });
}
