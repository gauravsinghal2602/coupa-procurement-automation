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
    schema: [
      { name: "Commodity/category Name", label: "Commodity / category Name", type: "text" },
      { name: "Key words", label: "Key words", type: "text" },
      { name: "Plant Code", label: "Plant Code", type: "text", required: true },
      { name: "Plant Name", label: "Plant Name", type: "text" },
      { name: "SAP vendor code", label: "SAP vendor code", type: "text", required: true },
      { name: "Vendor Name", label: "Vendor Name", type: "text" },
      { name: "Vendor contact details", label: "Vendor contact details", type: "text" },
      { name: "Vendor email id", label: "Vendor email id", type: "email" },
      { name: "created_by", label: "Created By", type: "text", readOnly: true },
      { name: "created_at", label: "Created At", type: "datetime-local", readOnly: true },
      { name: "updated_by", label: "Updated By", type: "text", readOnly: true },
      { name: "updated_at", label: "Updated At", type: "datetime-local", readOnly: true },
      { name: "status", label: "Status", type: "select", options: ["active", "deleted"] },
      { name: "reason_update", label: "Reason for Update", type: "text", optional: true },
      { name: "reason_delete", label: "Reason for Delete", type: "text", optional: true }
    ],
  };