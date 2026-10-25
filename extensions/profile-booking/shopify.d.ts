import '@shopify/ui-extensions';

//@ts-ignore
declare module './src/ProfileBooking.jsx' {
  const shopify: import('@shopify/ui-extensions/customer-account.profile.block.render').Api;
  const globalThis: { shopify: typeof shopify };
}
