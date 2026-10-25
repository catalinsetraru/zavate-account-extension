import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

const CUSTOMER_API_VERSION = '2026-07';
const MAX_PRODUCTS = 8;
const GRID_COLUMNS = '@container (inline-size > 500px) 1fr 1fr 1fr 1fr, 1fr 1fr';

/**
 * @typedef {object} Money
 * @property {string} amount
 * @property {string} currencyCode
 *
 * @typedef {object} ProductImage
 * @property {string} url
 * @property {string | null} [altText]
 *
 * @typedef {object} Product
 * @property {string} id
 * @property {string} title
 * @property {string} handle
 * @property {string | null} [onlineStoreUrl]
 * @property {ProductImage | null} [featuredImage]
 * @property {{minVariantPrice?: Money}} [priceRange]
 *
 * @typedef {object} Collection
 * @property {string} id
 * @property {string} title
 * @property {string} handle
 * @property {{nodes?: Product[]}} [products]
 *
 * @typedef {Product & {url: string | null}} RecommendedProduct
 *
 * @typedef {{data?: any, errors?: {message: string}[]}} StorefrontResult
 *
 * @typedef {{status: 'loading'} | {status: 'empty'} | {status: 'ready', subtitle: string, products: RecommendedProduct[]}} ViewState
 */

const LATEST_ORDER_QUERY = `
  query LatestOrder {
    customer {
      orders(first: 1, sortKey: PROCESSED_AT, reverse: true) {
        nodes {
          id
          lineItems(first: 10) {
            nodes {
              productId
            }
          }
        }
      }
    }
  }
`;

const PRODUCT_COLLECTIONS_QUERY = `
  query ProductCollections($id: ID!) {
    shop {
      primaryDomain {
        url
      }
    }
    product(id: $id) {
      id
      collections(first: 5) {
        nodes {
          id
          title
          handle
          products(first: 12) {
            nodes {
              id
              title
              handle
              onlineStoreUrl
              featuredImage {
                url
                altText
              }
              priceRange {
                minVariantPrice {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    }
  }
`;

const BROWSE_COLLECTIONS_QUERY = `
  query BrowseCollections {
    shop {
      primaryDomain {
        url
      }
    }
    collections(first: 20) {
      nodes {
        id
        title
        handle
        products(first: 12) {
          nodes {
            id
            title
            handle
            onlineStoreUrl
            featuredImage {
              url
              altText
            }
            priceRange {
              minVariantPrice {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }
  }
`;

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  /** @type {[ViewState, (value: ViewState) => void]} */
  const [view, setView] = useState(/** @type {ViewState} */ ({status: 'loading'}));

  useEffect(() => {
    loadRecommendations()
      .then(setView)
      .catch(() => setView({status: 'empty'}));
  }, []);

  if (view.status === 'loading') {
    return (
      <s-section heading={shopify.i18n.translate('heading')}>
        <s-spinner accessibilityLabel={shopify.i18n.translate('loading')} />
      </s-section>
    );
  }

  if (view.status !== 'ready') {
    return (
      <s-section heading={shopify.i18n.translate('heading')}>
        <s-banner tone="info">
          <s-text>{shopify.i18n.translate('empty')}</s-text>
        </s-banner>
      </s-section>
    );
  }

  return (
    <s-section heading={shopify.i18n.translate('heading')}>
      <s-stack direction="block" gap="base">
        <s-paragraph color="subdued">{view.subtitle}</s-paragraph>
        <s-query-container>
          <s-grid gridTemplateColumns={GRID_COLUMNS} gap="small">
            {view.products.map((product) => (
              <s-grid-item key={product.id}>
                <ProductCard product={product} />
              </s-grid-item>
            ))}
          </s-grid>
        </s-query-container>
      </s-stack>
    </s-section>
  );
}

/**
 * @param {{product: RecommendedProduct}} props
 */
function ProductCard({product}) {
  const price = formatPrice(product.priceRange?.minVariantPrice);
  const content = (
    <s-stack direction="block" gap="small-200">
      {product.featuredImage?.url ? (
        <s-image
          src={product.featuredImage.url}
          alt={product.featuredImage.altText || product.title}
          aspectRatio="1"
          objectFit="cover"
        />
      ) : (
        <s-box padding="base" background="subdued" borderRadius="base">
          <s-product-thumbnail alt={product.title} size="base" />
        </s-box>
      )}
      <s-text type="strong">{product.title}</s-text>
      {price ? <s-text color="subdued">{price}</s-text> : null}
    </s-stack>
  );

  if (!product.url) {
    return content;
  }

  return (
    <s-clickable
      href={product.url}
      target="_blank"
      accessibilityLabel={product.title}
    >
      {content}
    </s-clickable>
  );
}

/** @returns {Promise<ViewState>} */
async function loadRecommendations() {
  const purchasedIds = await fetchPurchasedProductIds();
  const sourceProductId = purchasedIds[0];

  if (sourceProductId) {
    const {data, errors} = /** @type {StorefrontResult} */ (
      await shopify.query(PRODUCT_COLLECTIONS_QUERY, {
        variables: {id: sourceProductId},
      })
    );

    if (!errors?.length) {
      const recos = pickRecommendations(
        data?.product?.collections?.nodes || [],
        new Set(purchasedIds),
      );

      if (recos) {
        return {
          status: 'ready',
          subtitle: shopify.i18n.translate('fromPurchase', {
            collection: recos.collection.title,
          }),
          products: withUrls(recos.products, data?.shop?.primaryDomain?.url),
        };
      }
    }
  }

  const {data, errors} = /** @type {StorefrontResult} */ (
    await shopify.query(BROWSE_COLLECTIONS_QUERY)
  );

  if (errors?.length) {
    return {status: 'empty'};
  }

  const recos = pickRecommendations(
    data?.collections?.nodes || [],
    new Set(purchasedIds),
    {random: !sourceProductId},
  );

  if (!recos) {
    return {status: 'empty'};
  }

  return {
    status: 'ready',
    subtitle: shopify.i18n.translate(
      sourceProductId ? 'fromPurchase' : 'discoverCollection',
      {collection: recos.collection.title},
    ),
    products: withUrls(recos.products, data?.shop?.primaryDomain?.url),
  };
}

/**
 * `onlineStoreUrl` is null for products that aren't published to the Online
 * Store channel, so fall back to the canonical product path on the shop domain.
 *
 * @param {Product[]} products
 * @param {string | undefined} shopUrl
 * @returns {RecommendedProduct[]}
 */
function withUrls(products, shopUrl) {
  return products.map((product) => ({
    ...product,
    url:
      product.onlineStoreUrl ||
      (shopUrl && product.handle
        ? `${shopUrl.replace(/\/$/, '')}/products/${product.handle}`
        : null),
  }));
}

/** @returns {Promise<string[]>} */
async function fetchPurchasedProductIds() {
  const response = await fetch(
    `shopify://customer-account/api/${CUSTOMER_API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({query: LATEST_ORDER_QUERY}),
    },
  );
  const json = await response.json();

  if (json?.errors?.length) {
    console.error(
      '[profile-recommendations] Customer Account API request failed, falling back to a random collection',
      json.errors,
    );
    return [];
  }

  const order = json?.data?.customer?.orders?.nodes?.[0];

  if (!order) {
    return [];
  }

  return (order.lineItems?.nodes || [])
    .map((/** @type {{productId?: string}} */ item) => item.productId)
    .filter(Boolean);
}

/**
 * @param {Collection[]} collections
 * @param {Set<string>} purchasedIds
 * @param {{random?: boolean}} [options]
 */
function pickRecommendations(collections, purchasedIds, options = {}) {
  const eligible = collections.filter((collection) =>
    (collection.products?.nodes || []).some(
      (product) => !purchasedIds.has(product.id),
    ),
  );

  if (!eligible.length) {
    return null;
  }

  const collection = options.random
    ? eligible[Math.floor(Math.random() * eligible.length)]
    : eligible[0];

  const products = (collection.products?.nodes || [])
    .filter((product) => !purchasedIds.has(product.id))
    .slice(0, MAX_PRODUCTS);

  if (!products.length) {
    return null;
  }

  return {collection, products};
}

/** @param {Money | undefined} money */
function formatPrice(money) {
  if (!money?.amount) {
    return '';
  }

  const amount = Number(money.amount);
  if (!Number.isFinite(amount)) {
    return '';
  }

  return shopify.i18n.formatCurrency(amount);
}
