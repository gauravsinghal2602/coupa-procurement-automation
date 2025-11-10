# DynamoDB Admin Frontend (Vanilla JS)

This is a minimal client to browse and perform CRUD against your API Gateway + Lambda CRUD endpoints for a DynamoDB table.

## Setup

1) Copy `config.example.js` to `config.js` and set your values:

```
baseUrl: "https://your-api-id.execute-api.region.amazonaws.com/prod",
partitionKeyName: "sapVendorCode",
sortKeyName: "plantCode"  # set null if not used
```

2) Serve the `frontend/` folder with any static server, or open `index.html` directly in a modern browser (CORS must be allowed by your API Gateway for your origin/file).

Examples to serve locally:

- PowerShell: `cd frontend; python -m http.server 8080`
- Node: `npx http-server -p 8080 frontend`

Then open: `http://localhost:8080/index.html`

## Endpoints Contract

By default the app expects:

- GET `GET {baseUrl}/items` → returns `{ items: [...] }` or `[...]`
- CREATE `POST {baseUrl}/items` body: `{ sapVendorCode, plantCode, ...attributes }`
- UPDATE `PUT {baseUrl}/items/{sapVendorCode}/{plantCode}` body: `{ sapVendorCode, plantCode, ...attributes }`
- DELETE `DELETE {baseUrl}/items/{sapVendorCode}/{plantCode}`

Adjust in `config.js` if your paths differ.

## Notes

- Ensure API Gateway has CORS enabled for your origin.
- `primaryKeyName` should match your DynamoDB primary key attribute.
- The attributes field accepts JSON that will be merged with the key into the request body.


