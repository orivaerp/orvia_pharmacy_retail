/** Used by `ng build` (the production configuration). `ng serve` uses environment.ts (the local API) instead. */
export const environment = {
  production: true,
  apiUrl: 'https://apis.stuintern.in/api/v1',
  siteUrl: 'https://pharmacy.orviaerp.com',
  /** the product page on the main website, shown under the sign-in form */
  marketingUrl: 'https://www.orviaerp.com/services/pharmacy-software',
  /** where "Start free trial" goes (empty hides the link) */
  signupUrl: '/signup',
  /** the pages a new owner agrees to when starting a trial (they must exist on the main website) */
  termsUrl: '/terms',
  privacyUrl: '/privacy',
};
