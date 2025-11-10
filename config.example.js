// Copy this file to config.js and fill in your API Gateway base URL and options
// Example shapes assume endpoints:
//  GET    {baseUrl}/items
//  POST   {baseUrl}/items                body: { id, ...attributes }
//  PUT    {baseUrl}/items/{id}           body: { id, ...attributes }
//  DELETE {baseUrl}/items/{id}

window.APP_CONFIG = {
  baseUrl: "https://your-api-id.execute-api.region.amazonaws.com/prod",
  // Set your DynamoDB key names
  partitionKeyName: "sapVendorCode", // e.g., SAP vendor code
  sortKeyName: "plantCode",          // e.g., Plant Code (set null if not used)
  endpoints: {
    list: "/items",
    create: "/items",
    // For composite keys, update/delete receive (pk, sk)
    // Adjust these if your API format differs (e.g., query params instead of path)
    update: (pk, sk) => sk != null ? `/items/${encodeURIComponent(pk)}/${encodeURIComponent(sk)}` : `/items/${encodeURIComponent(pk)}`,
    delete: (pk, sk) => sk != null ? `/items/${encodeURIComponent(pk)}/${encodeURIComponent(sk)}` : `/items/${encodeURIComponent(pk)}`,
  },
  requestInit: {
    headers: {
      "Content-Type": "application/json",
      // Add auth headers if needed, e.g. "x-api-key": "YOUR_KEY"
    },
    credentials: "omit",
    mode: "cors",
  },
};


