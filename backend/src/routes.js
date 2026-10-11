import { Router } from 'express';
import { authenticate, requireActiveTenant } from './middleware/auth.js';
import authRoutes from './modules/auth/auth.routes.js';
import branchRoutes from './modules/branches/branch.routes.js';
import productRoutes from './modules/products/product.routes.js';
import { purchaseRouter, returnRouter, supplierRouter } from './modules/purchases/purchase.routes.js';
import { supportAccessRouter } from './modules/support/support.routes.js';
import { shopBillingRouter } from './modules/billing/billing.routes.js';
import customerRoutes from './modules/customers/customer.routes.js';
import paymentRoutes from './modules/payments/payment.routes.js';
import webhookRoutes from './modules/payments/webhook.routes.js';
import reportRoutes from './modules/sales/report.routes.js';
import saleRoutes from './modules/sales/sale.routes.js';
import stockRoutes from './modules/stock/stock.routes.js';
import shopRoutes from './modules/tenants/shop.routes.js';
import importRoutes from './modules/imports/import.routes.js';
import { cashRouter, expenseRouter } from './modules/accounts/account.routes.js';
import stockCountRoutes from './modules/stock/stock-count.routes.js';
import activityRoutes from './modules/audit/activity.routes.js';
import publicRoutes from './modules/sales/public.routes.js';
import refillRoutes from './modules/customers/refill.routes.js';
import orderRoutes from './modules/purchases/order.routes.js';
import signupRoutes from './modules/signup/signup.routes.js';
import userRoutes from './modules/users/user.routes.js';
import providerRoutes from './modules/provider/provider.routes.js';

const api = Router();

api.get('/health', (_req, res) => res.json({ status: 'ok', service: 'orvia-api' }));

// Public
api.use('/auth', authRoutes);
api.use('/webhooks', webhookRoutes); // signed by the gateway, no login
api.use('/public', publicRoutes); // a customer's bill link, no login (the token is the key)
api.use('/public', signupRoutes); // the pricing list and self sign-up, no login

// Everything below requires a valid token (and runs inside the tenant context)
api.use(authenticate, requireActiveTenant);
api.use('/provider', providerRoutes);
api.use('/branches', branchRoutes);
api.use('/products', productRoutes);
api.use('/stock', stockRoutes);
api.use('/stock-counts', stockCountRoutes);
api.use('/sales', saleRoutes);
api.use('/refills', refillRoutes);
api.use('/customers', customerRoutes);
api.use('/billing', shopBillingRouter);
api.use('/reports', reportRoutes);
api.use('/payments', paymentRoutes);
api.use('/support-access', supportAccessRouter);
api.use('/suppliers', supplierRouter);
api.use('/purchases', purchaseRouter);
api.use('/purchase-orders', orderRoutes);
api.use('/purchase-returns', returnRouter);
api.use('/users', userRoutes);
api.use('/shop', shopRoutes);
api.use('/activity', activityRoutes);
api.use('/import', importRoutes);
api.use('/expenses', expenseRouter);
api.use('/cash', cashRouter);

export default api;
