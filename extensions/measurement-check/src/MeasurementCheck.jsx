import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

const API_VERSION = '2026-07';
const AGREEMENT_NAMESPACE = 'custom';
const AGREEMENT_KEY = 'no_measurement_agreement';
const DEFAULT_MONTHS_THRESHOLD = 12;

const CUSTOMER_QUERY = `
  query MeasurementCheck {
    customer {
      id
      agreement: metafield(
        namespace: "custom"
        key: "no_measurement_agreement"
      ) {
        value
      }
      orders(first: 1, sortKey: PROCESSED_AT, reverse: true) {
        nodes {
          processedAt
        }
      }
    }
  }
`;

const SAVE_AGREEMENT_MUTATION = `
  mutation SaveMeasurementAgreement($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        namespace
        key
        value
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const [customer, setCustomer] = useState(null);
  const [status, setStatus] = useState('loading');
  const [sameMeasurements, setSameMeasurements] = useState('');
  const [lastWornDate, setLastWornDate] = useState('');
  const [needsShowroom, setNeedsShowroom] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState('');
  const privateViewingUrl =
    shopify.settings.value?.private_viewing_url?.trim() || '';
  const monthsThreshold =
    shopify.settings.value?.months_threshold ?? DEFAULT_MONTHS_THRESHOLD;

  useEffect(() => {
    loadCustomer()
      .then((result) => {
        setCustomer(result);
        setStatus('ready');
      })
      .catch((loadError) => {
        console.error('[measurement-check] Failed to load customer', loadError);
        setStatus('error');
      });
  }, []);

  // Stay invisible until we know the check applies, otherwise every customer
  // sees the heading flash and vanish.
  if (status === 'loading') {
    return null;
  }

  if (getHiddenReason(status, customer, monthsThreshold)) {
    return null;
  }

  const hasOrderHistory = Boolean(customer.lastOrderDate);
  const canSave =
    needsShowroom === 'no' &&
    accepted &&
    (!hasOrderHistory || (Boolean(sameMeasurements) && Boolean(lastWornDate)));

  async function saveAgreement() {
    if (!canSave) {
      return;
    }

    setStatus('saving');
    setError('');

    try {
      await writeAgreement(customer.id);
      setStatus('saved');
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : shopify.i18n.translate('saveError'),
      );
      setStatus('ready');
    }
  }

  if (status === 'saved') {
    return (
      <s-section heading={shopify.i18n.translate('heading')}>
        <s-banner tone="success">
          <s-text>{shopify.i18n.translate('saved')}</s-text>
        </s-banner>
      </s-section>
    );
  }

  return (
    <s-section heading={shopify.i18n.translate('heading')}>
      <s-stack direction="block" gap="base">
        <s-banner tone="warning">
          <s-text>
            {hasOrderHistory
              ? shopify.i18n.translate('lastOrder', {
                  months: shopify.i18n.formatNumber(
                    fullMonthsSince(customer.lastOrderDate),
                  ),
                  date: new Date(customer.lastOrderDate).toLocaleDateString(),
                })
              : shopify.i18n.translate('noOrders')}
          </s-text>
        </s-banner>

        {hasOrderHistory ? (
          <s-choice-list
            label={shopify.i18n.translate('sameMeasurements')}
            name="same-measurements"
            onChange={(event) => setSameMeasurements(choiceValue(event))}
          >
            <s-choice value="yes" selected={sameMeasurements === 'yes'}>
              {shopify.i18n.translate('yes')}
            </s-choice>
            <s-choice value="no" selected={sameMeasurements === 'no'}>
              {shopify.i18n.translate('no')}
            </s-choice>
          </s-choice-list>
        ) : null}

        {hasOrderHistory ? (
          <s-date-field
            label={shopify.i18n.translate('lastWorn')}
            name="last-worn-date"
            value={lastWornDate}
            onChange={(event) => setLastWornDate(fieldValue(event))}
          />
        ) : null}

        <s-choice-list
          label={shopify.i18n.translate('needsShowroom')}
          name="needs-showroom"
          onChange={(event) => setNeedsShowroom(choiceValue(event))}
        >
          <s-choice value="yes" selected={needsShowroom === 'yes'}>
            {shopify.i18n.translate('yes')}
          </s-choice>
          <s-choice value="no" selected={needsShowroom === 'no'}>
            {shopify.i18n.translate('no')}
          </s-choice>
        </s-choice-list>

        {needsShowroom === 'yes' ? (
          <s-stack direction="block" gap="small">
            <s-text>{shopify.i18n.translate('showroomRecommendation')}</s-text>
            {privateViewingUrl ? (
              <s-button
                variant="primary"
                href={privateViewingUrl}
                target="_blank"
              >
                {shopify.i18n.translate('requestViewing')}
              </s-button>
            ) : null}
          </s-stack>
        ) : null}

        {needsShowroom === 'no' ? (
          <s-stack direction="block" gap="base">
            <s-banner tone="warning">
              <s-text>{shopify.i18n.translate('remeasureRecommendation')}</s-text>
            </s-banner>
            <s-checkbox
              label={shopify.i18n.translate('agreement')}
              checked={accepted}
              onChange={(event) => setAccepted(checkedValue(event))}
            />
            {error ? (
              <s-banner tone="critical">
                <s-text>{error}</s-text>
              </s-banner>
            ) : null}
            <s-button
              variant="primary"
              disabled={!canSave}
              loading={status === 'saving'}
              onClick={saveAgreement}
            >
              {shopify.i18n.translate('saveAgreement')}
            </s-button>
          </s-stack>
        ) : null}
      </s-stack>
    </s-section>
  );
}

async function loadCustomer() {
  const response = await customerAccountRequest(CUSTOMER_QUERY);
  const customer = response.data?.customer;

  if (!customer) {
    throw new Error('Customer could not be loaded.');
  }

  return {
    id: customer.id,
    hasAgreement: customer.agreement?.value === 'true',
    lastOrderDate: customer.orders?.nodes?.[0]?.processedAt || null,
  };
}

async function writeAgreement(customerId) {
  const response = await customerAccountRequest(SAVE_AGREEMENT_MUTATION, {
    metafields: [
      {
        ownerId: customerId,
        namespace: AGREEMENT_NAMESPACE,
        key: AGREEMENT_KEY,
        type: 'boolean',
        value: 'true',
      },
    ],
  });
  const result = response.data?.metafieldsSet;
  const message = result?.userErrors?.[0]?.message;

  if (message || result?.metafields?.[0]?.value !== 'true') {
    throw new Error(message || shopify.i18n.translate('saveError'));
  }
}

async function customerAccountRequest(query, variables = {}) {
  const response = await fetch(
    `shopify://customer-account/api/${API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({query, variables}),
    },
  );
  const json = await response.json();

  if (!response.ok || json.errors?.length) {
    throw new Error(
      json.errors?.[0]?.message || shopify.i18n.translate('saveError'),
    );
  }

  return json;
}

/**
 * Returns why the block should render nothing, or null when it should render.
 */
function getHiddenReason(status, customer, monthsThreshold) {
  if (status === 'error') {
    return 'the Customer Account API request failed';
  }

  if (!customer) {
    return 'the customer could not be loaded';
  }

  if (customer.hasAgreement) {
    return 'custom.no_measurement_agreement is already true';
  }

  // Customers without an order have no measurements on file, so the check
  // always applies to them. The threshold only makes sense once they've ordered.
  if (!customer.lastOrderDate) {
    return null;
  }

  const months = fullMonthsSince(customer.lastOrderDate);

  if (months < monthsThreshold) {
    return `last order is ${months} month(s) old, threshold is ${monthsThreshold}`;
  }

  return null;
}

function fullMonthsSince(value) {
  const date = new Date(value);
  const today = new Date();
  let months =
    (today.getFullYear() - date.getFullYear()) * 12 +
    today.getMonth() -
    date.getMonth();

  if (today.getDate() < date.getDate()) {
    months -= 1;
  }

  return Math.max(months, 0);
}

/** @param {any} event */
function choiceValue(event) {
  return event.currentTarget.values[0] || '';
}

/** @param {any} event */
function fieldValue(event) {
  return event.currentTarget.value;
}

/** @param {any} event */
function checkedValue(event) {
  return event.currentTarget.checked;
}
