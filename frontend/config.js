window.APP_CONFIG = {
    baseUrl: "https://7ry81qpmkc.execute-api.ap-south-1.amazonaws.com/prod",
    partitionKeyName: "SAP vendor code",
    sortKeyName: "Plant Code",
    endpoints: {
      list: "/suppliers",
      getOne: "/supplier", // GET with query params
      create: "/supplier",
      bulkCreateCsv: "/suppliers", // POST text/csv
      // PATCH /supplier with keys in body and updateKey/updateValue
      update: "/supplier",
      // DELETE /supplier with keys in body
      delete: "/supplier",
      downloadAll: "/suppliers/download/all",
      downloadFiltered: "/suppliers/download/filtered",
    },
    requestInit: {
      headers: {
        "Content-Type": "application/json",
        // "x-api-key": "YOUR_KEY"  // if your API is key-protected
      },
      credentials: "omit",
      mode: "cors",
    },
  };