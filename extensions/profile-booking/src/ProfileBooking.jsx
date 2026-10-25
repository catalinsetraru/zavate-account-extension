import '@shopify/ui-extensions/preact';
import {render} from 'preact';

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const customer = shopify.authenticatedAccount.customer.value;
  const schedulingUrl = shopify.settings.value?.calendly_url?.trim();

  if (!schedulingUrl) {
    return null;
  }

  return (
    <s-section heading={shopify.i18n.translate('heading')}>
      <s-stack direction="block" gap="base">
        <s-paragraph color="subdued">
          {shopify.i18n.translate('description')}
        </s-paragraph>
        <s-button
          variant="primary"
          href={buildBookingUrl(schedulingUrl, customer)}
          target="_blank"
        >
          {shopify.i18n.translate('cta')}
        </s-button>
      </s-stack>
    </s-section>
  );
}

/**
 * Calendly reads `name` and `email` from the query string to prefill its form.
 * Both are undefined unless the app has level 2 protected customer data access.
 *
 * @param {string} baseUrl
 * @param {{fullName?: string, firstName?: string, email?: string} | undefined} customer
 */
function buildBookingUrl(baseUrl, customer) {
  const params = new URLSearchParams();
  const name = customer?.fullName || customer?.firstName;

  if (name) {
    params.set('name', name);
  }

  if (customer?.email) {
    params.set('email', customer.email);
  }

  const query = params.toString();
  if (!query) {
    return baseUrl;
  }

  return baseUrl.includes('?') ? `${baseUrl}&${query}` : `${baseUrl}?${query}`;
}
