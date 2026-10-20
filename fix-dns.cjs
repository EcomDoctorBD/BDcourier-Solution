const dns = require("dns");
const originalLookup = dns.lookup;

const SHOPIFY_AUTH_EDGE_IP = "34.128.177.21";
const SHOPIFY_APP_EDGE_IP = "34.144.193.86";
const SHOPIFY_STORE_EDGE_IP = "23.227.37.1";

const AUTH_HOSTS = new Set([
  "accounts.shopify.com",
  "destinations.shopifysvc.com",
  "partners.shopify.com",
  "api.shopify.com",
  "monorail-edge.shopifysvc.com",
]);

const APP_HOSTS = new Set([
  "app.shopify.com",
  "cname.shopify.com",
  "core-misc.tm.shopifysvc.com",
]);

/**
 * Intelligent DNS interceptor:
 * - Maps Shopify auth & partner services to 34.128.177.21 (Google Edge)
 * - Maps Shopify app management endpoints to 34.144.193.86 (Google Cloud Edge)
 * - Maps Shopify store domains (*.myshopify.com) to 23.227.37.1 (Active Edge)
 * This completely prevents Anycast packet drops on 23.227.38.x and 23.227.39.x.
 */
dns.lookup = function (hostname, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }

  // 1. App management platform endpoints (core-misc)
  if (APP_HOSTS.has(hostname)) {
    if (options && options.all) {
      return callback(null, [{ address: SHOPIFY_APP_EDGE_IP, family: 4 }]);
    }
    return callback(null, SHOPIFY_APP_EDGE_IP, 4);
  }

  // 2. Auth & Admin platform endpoints
  if (AUTH_HOSTS.has(hostname)) {
    if (options && options.all) {
      return callback(null, [{ address: SHOPIFY_AUTH_EDGE_IP, family: 4 }]);
    }
    return callback(null, SHOPIFY_AUTH_EDGE_IP, 4);
  }

  // 3. Development Store & Storefront endpoints
  if (hostname.endsWith(".myshopify.com") || hostname === "shops.myshopify.com") {
    if (options && options.all) {
      return callback(null, [{ address: SHOPIFY_STORE_EDGE_IP, family: 4 }]);
    }
    return callback(null, SHOPIFY_STORE_EDGE_IP, 4);
  }

  return originalLookup(hostname, options, callback);
};
