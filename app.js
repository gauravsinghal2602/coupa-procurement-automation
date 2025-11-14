(function () {
  console.log('=== APP.JS LOADED ===');
  const defaultConfig = {
    baseUrl: "",
    // For composite keys, set both. If only partitionKeyName is set, app will treat as single key.
    partitionKeyName: "id",
    sortKeyName: null, // e.g., "sk"
    schema: [], // optional: [{ name, label, type, required }]
    endpoints: {
      list: "/items",
      create: "/items",
      // For composite keys, these functions receive (pk, sk)
      update: (pk, sk) => sk != null ? `/items/${encodeURIComponent(pk)}/${encodeURIComponent(sk)}` : `/items/${encodeURIComponent(pk)}`,
      delete: (pk, sk) => sk != null ? `/items/${encodeURIComponent(pk)}/${encodeURIComponent(sk)}` : `/items/${encodeURIComponent(pk)}`,
    },
    requestInit: {
      // Customize headers if your API requires auth keys etc.
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      mode: "cors",
    },
  };

  const cfg = (window.APP_CONFIG && mergeConfig(defaultConfig, window.APP_CONFIG)) || defaultConfig;

  // Normalize schema: remove PK/SK fields and deduplicate by name (case-insensitive)
  (function normalizeSchema() {
    if (!Array.isArray(cfg.schema)) return;
    const norm = (s) => String(s || "").trim().toLowerCase();
    const pkN = norm(cfg.partitionKeyName);
    const skN = norm(cfg.sortKeyName);
    const seen = new Set();
    const filtered = [];
    for (const f of cfg.schema) {
      const nameN = norm(f && f.name);
      if (!nameN) continue;
      if (nameN === pkN || (skN && nameN === skN)) continue;
      if (seen.has(nameN)) continue;
      seen.add(nameN);
      filtered.push(f);
    }
    cfg.schema = filtered;
  })();

  const el = (id) => document.getElementById(id);
  const statusEl = el("status");
  const viewAllBtn = el("viewAllBtn");
  const createBtn = el("createBtn");
  const updateBtn = el("updateBtn");
  const deleteBtn = el("deleteBtn");
  const itemsTbody = el("itemsTbody");
  const itemsThead = el("itemsThead");
  const conditionsEl = el("conditions");
  const addConditionBtn = el("addConditionBtn");
  const applyFilterBtn = el("applyFilterBtn");
  const clearFilterBtn = el("clearFilterBtn");
  const deleteSelectedBtn = el("deleteSelectedBtn");
  const restoreSelectedBtn = el("restoreSelectedBtn");
  const downloadAllBtn = el("downloadAllBtn");
  const downloadFilteredBtn = el("downloadFilteredBtn");
  const pageSizeSelect = el("pageSizeSelect");
  const prevPageBtn = el("prevPageBtn");
  const nextPageBtn = el("nextPageBtn");
  const pageInfo = el("pageInfo");
  const itemForm = el("itemForm");
  const pkInput = el("pkInput");
  const skInput = el("skInput");
  const attributesInput = el("attributesInput");
  const attributesRow = el("attributesRow");
  const attributesFields = el("attributesFields");
  const formTitle = el("formTitle");
  const saveBtn = el("saveBtn");
  const cancelEditBtn = el("cancelEditBtn");
  const csvRow = document.getElementById("csvRow");
  const csvInput = document.getElementById("csvInput");
  const uploadCsvBtn = document.getElementById("uploadCsvBtn");
  const viewDeletedBtn = el("viewDeletedBtn"); // Get the new button
  const formSection = document.getElementById("formSection");
  const tableSection = document.getElementById("tableSection");
  const pkHeader = el("pkHeader");
  const skHeader = el("skHeader");
  const pkLabel = document.getElementById("pkLabel");
  const skLabel = document.getElementById("skLabel");
  const skRow = document.getElementById("skRow");

  // Configure labels/visibility based on keys
  const pkLabelText = cfg.partitionKeyName || "Partition Key";
  pkHeader.textContent = pkLabelText;
  pkLabel.textContent = pkLabelText;
  appendRequiredIndicator(pkLabel, true);
  if (cfg.sortKeyName) {
    const skLabelText = cfg.sortKeyName;
    skHeader.textContent = skLabelText;
    skLabel.textContent = skLabelText;
    skRow.classList.remove("hidden");
    skInput.required = true;
    appendRequiredIndicator(skLabel, true);
  } else {
    skRow.classList.add("hidden");
    if (skInput) skInput.required = false;
    appendRequiredIndicator(skLabel, false);
  }
  // Initial state: hide sections until an action is chosen
  formSection.classList.add("hidden");
  tableSection.classList.add("hidden");

  // Render schema-driven fields if provided
  if (hasSchema()) { try { document.body && document.body.setAttribute("data-schema", "on"); } catch (_) {} }
  renderAttributeFields();

  let editState = { isEditing: false, pk: null, sk: null };
  let allItems = [];
  let columnOrder = [];
  let lastRendered = [];
  let currentPage = 1;
  let pageSize = 25;
  let filteredItems = null; // if set, paginate this instead of allItems
  let currentStatusFilter = 'active'; // New state variable: 'active' or 'inactive'
  let selectedItems = new Set(); // Track selected items by unique key (pk or pk+sk)

  // Initialize page size from UI if present
  if (pageSizeSelect && pageSizeSelect.value) {
    const n = Number(pageSizeSelect.value);
    if (Number.isFinite(n) && n > 0) pageSize = n;
  }

  function hasSchema() { return Array.isArray(cfg.schema) && cfg.schema.length > 0; }
  function fieldId(name) { return `attr_${String(name).replace(/[^a-zA-Z0-9_-]/g, '_')}`; }

  function appendRequiredIndicator(labelEl, isRequired) {
    if (!labelEl) return;
    const existing = labelEl.querySelector('.required-indicator');
    if (existing) {
      existing.remove();
    }
    if (isRequired) {
      const indicator = document.createElement('span');
      indicator.className = 'required-indicator';
      indicator.textContent = ' *';
      labelEl.appendChild(indicator);
    }
  }

  function getFilteredSchema() {
    const internalFields = ['created_by', 'updated_by', 'created_at', 'updated_at', 'status', 'reason_update', 'reason_delete'];
    return Array.isArray(cfg.schema) ? cfg.schema.filter(field => !internalFields.includes(field.name)) : [];
  }

  function renderAttributeFields() {
    if (!hasSchema()) { if (attributesFields) attributesFields.classList.add("hidden"); attributesInput.classList.remove("hidden"); return; }
    attributesFields.innerHTML = "";
    for (const field of getFilteredSchema()) {
      const wrap = document.createElement("div");
      wrap.className = "form-row compact";
      const label = document.createElement("label");
      label.textContent = field.label || field.name;
      label.htmlFor = fieldId(field.name);
      const input = document.createElement("input");
      input.id = fieldId(field.name);
      input.name = field.name;
      input.type = field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "email" ? "email" : "text";
      if (field.placeholder) {
        input.placeholder = field.placeholder;
      } else {
        const defaultPlaceholder = field.label || field.name;
        if (defaultPlaceholder) input.placeholder = defaultPlaceholder;
      }
      if (field.required) {
        input.required = true;
        input.dataset.originalRequired = "true";
      } else {
        input.dataset.originalRequired = "false";
      }
      wrap.appendChild(label);
      wrap.appendChild(input);
      attributesFields.appendChild(wrap);
    }
    attributesFields.classList.remove("hidden");
    attributesInput.classList.add("hidden");
  }

  function setAttributeInputsEnabled(enabled) {
    if (hasSchema()) {
      if (!attributesFields) return;
      const controls = attributesFields.querySelectorAll("input, select, textarea");
      controls.forEach((control) => {
        if (!control.dataset.originalRequired) {
          control.dataset.originalRequired = control.required ? "true" : "false";
        }
        control.disabled = !enabled;
        if (enabled && control.dataset.originalRequired === "true") {
          control.required = true;
          control.setAttribute("required", "");
        } else {
          control.required = false;
          control.removeAttribute("required");
        }
      });
    } else if (attributesInput) {
      attributesInput.disabled = !enabled;
      if (!enabled) {
        attributesInput.removeAttribute("required");
      }
    }
  }

  function renderUpdateSingleFieldUI(prefill) { /* deprecated: keep for fallback; multi-field update is default now */
    renderAttributeFields();
    if (prefill) setAttributesToForm(prefill, true);
  }

  function coerceValueByType(val, type) {
    if (val == null || val === "") return undefined;
    if (type === "number") { const n = Number(val); return Number.isFinite(n) ? n : undefined; }
    if (type === "boolean") { return String(val).toLowerCase() === "true"; }
    if (type === "date") { return val; }
    if (type === "email") { return String(val).trim(); }
    return String(val);
  }

  function getAttributesFromForm(forUpdate) {
    if (!hasSchema()) return safeParseJson(attributesInput.value);
    // New update rows UI present?
    const list = document.getElementById("updateRows");
    if (forUpdate && list) {
      const out = {};
      const rows = Array.from(list.querySelectorAll('.update-row'));
      for (const row of rows) {
        const sel = row.querySelector('select.update-field');
        const valEl = row.querySelector('input.update-value');
        if (!sel || !valEl) continue;
        const f = getFilteredSchema().find(x => x.name === sel.value) || {};
        const v = coerceValueByType(valEl.value, f.type);
        if (v !== undefined && v !== "") out[sel.value] = v;
      }
      if (Object.keys(out).length < 1) throw new Error("For update, add at least one field and value.");
      return out;
    }
    // Create mode: collect all fields
    const out = {};
    let countFilled = 0;
    for (const field of getFilteredSchema()) {
      const input = document.getElementById(fieldId(field.name));
      if (!input) continue;
      const v = coerceValueByType(input.value, field.type);
      if (v !== undefined && v !== "") { out[field.name] = v; countFilled++; }
    }
    if (forUpdate) {
      if (countFilled < 1) throw new Error("For update, fill at least one attribute field.");
    }
    return out;
  }

  function setAttributesToForm(attrs, onlyFirst) {
    if (!hasSchema()) {
      attributesInput.value = JSON.stringify(attrs && typeof attrs === "object" ? attrs : {}, null, 2);
      return;
    }
    // If update UI is present, set select/value
    const selEl = document.getElementById("attr_select");
    const valEl = document.getElementById("attr_value");
    if (selEl && valEl) {
      const entries = Object.entries(attrs || {});
      if (entries.length > 0) {
        selEl.value = entries[0][0];
        valEl.value = entries[0][1];
      } else {
        valEl.value = "";
      }
      return;
    }
    // Otherwise, populate create form inputs
    for (const field of getFilteredSchema()) {
      const input = document.getElementById(fieldId(field.name));
      if (input) input.value = "";
    }
    if (!attrs || typeof attrs !== "object") return;
    if (onlyFirst) {
      const entries = Object.entries(attrs);
      if (entries.length > 0) {
        const [k, v] = entries[0];
        const input = document.getElementById(fieldId(k));
        if (input) input.value = v;
      }
      return;
    }
    for (const [k, v] of Object.entries(attrs)) {
      const input = document.getElementById(fieldId(k));
      if (input) input.value = v;
    }
  }

  function mergeConfig(base, override) {
    const out = { ...base, ...override };
    out.endpoints = {
      ...base.endpoints,
      ...(override.endpoints || {}),
    };
    out.requestInit = {
      ...base.requestInit,
      ...(override.requestInit || {}),
      headers: { ...(base.requestInit.headers || {}), ...(((override.requestInit || {}).headers) || {}) },
    };
    return out;
  }

  function buildUrl(endpoint) {
    if (!endpoint) return cfg.baseUrl;
    if (typeof endpoint === "function") return cfg.baseUrl + endpoint.apply(null, Array.prototype.slice.call(arguments, 1));
    return cfg.baseUrl + endpoint;
  }

  function setStatus(text, isError) {
    statusEl.textContent = text || "";
    statusEl.style.color = isError ? "#ef4444" : "";
  }

  async function apiGetList(statusFilter) {
    const url = buildUrl(cfg.endpoints.list);
    const params = new URLSearchParams();
    if (statusFilter) {
      params.append('status', statusFilter);
    }
    const fullUrl = url + (params.toString() ? `?${params.toString()}` : '');
    const res = await fetch(fullUrl, { ...cfg.requestInit, method: "GET" });
    if (!res.ok) throw new Error(`List failed: ${res.status}`);
    return res.json();
  }

  // Simplified UI: remove query-by-keys function

  async function apiCreate(pk, sk, attributes) {
    const url = buildUrl(cfg.endpoints.create);
    const body = buildBody(pk, sk, attributes);
    const res = await fetch(url, { ...cfg.requestInit, method: "POST", body });
    if (!res.ok) throw new Error(`Create failed: ${res.status}`);
    return res.json().catch(() => ({}));
  }

  async function apiBulkCreateCsv(file) {
    const url = buildUrl(cfg.endpoints.bulkCreateCsv);
    // Clone headers without Content-Type, we will set text/csv
    const headers = { ...(cfg.requestInit.headers || {}) };
    delete headers["Content-Type"];
    const res = await fetch(url, {
      method: "POST",
      mode: cfg.requestInit.mode || "cors",
      credentials: cfg.requestInit.credentials || "omit",
      headers: { ...headers, "Content-Type": "text/csv" },
      body: file,
    });
    if (!res.ok) throw new Error(`Bulk upload failed: ${res.status}`);
    return res.json().catch(() => ({}));
  }

  async function apiUpdate(pk, sk, attributes) {
    const url = buildUrl(cfg.endpoints.update);
    const body = buildPatchBody(pk, sk, attributes);
    const res = await fetch(url, { ...cfg.requestInit, method: "PATCH", body });
    if (!res.ok) {
      let errorMessage = `Update failed: ${res.status}`;
      try {
        const errJson = await res.json();
        if (errJson && errJson.message) {
          errorMessage = errJson.message;
        } else if (errJson && errJson.error) {
          errorMessage = errJson.error;
        }
      } catch {
        try {
          const errText = await res.text();
          if (errText) errorMessage = errText;
        } catch {}
      }
      throw new Error(errorMessage);
    }
    return res.json().catch(() => ({}));
  }

  async function apiDelete(deletePayload) {
    const url = buildUrl(cfg.endpoints.delete);
    const pk = deletePayload[cfg.partitionKeyName];
    const sk = cfg.sortKeyName ? deletePayload[cfg.sortKeyName] : null;
    const attributes = { ...deletePayload };
    delete attributes[cfg.partitionKeyName];
    if (cfg.sortKeyName) delete attributes[cfg.sortKeyName];
    
    const body = buildBody(pk, sk, attributes);
    const res = await fetch(url, { ...cfg.requestInit, method: "DELETE", body });
    if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
    return res.json().catch(() => ({}));
  }

  function buildBody(pk, sk, attributes) {
    const payload = { [cfg.partitionKeyName]: pk };
    if (cfg.sortKeyName && sk != null) payload[cfg.sortKeyName] = sk;
    if (attributes && typeof attributes === "object") {
      Object.assign(payload, attributes);
    }
    return JSON.stringify(payload);
  }

  function buildPatchBody(pk, sk, attributes) {
    const payload = { [cfg.partitionKeyName]: pk };
    if (cfg.sortKeyName && sk != null) payload[cfg.sortKeyName] = sk;
    const attrs = attributes || {};
    for (const [k, v] of Object.entries(attrs)) {
      if (k === cfg.partitionKeyName || k === cfg.sortKeyName) continue;
      payload[k] = v;
    }
    return JSON.stringify(payload);
  }

  function safeParseJson(str) {
    if (!str || !str.trim()) return {};
    try { return JSON.parse(str); } catch (e) { throw new Error("Attributes must be valid JSON"); }
  }

  // Helper function to get unique key for an item
  function getItemKey(pk, sk) {
    return sk != null ? `${pk}::${sk}` : String(pk);
  }

  // Helper function to check if item is selected
  function isItemSelected(pk, sk) {
    return selectedItems.has(getItemKey(pk, sk));
  }

  // Helper function to toggle item selection
  function toggleItemSelection(pk, sk) {
    const key = getItemKey(pk, sk);
    if (selectedItems.has(key)) {
      selectedItems.delete(key);
    } else {
      selectedItems.add(key);
    }
  }

  // Helper function to select/deselect all items on current page
  function toggleSelectAll(checked) {
    const pageItems = getPagedItems(getSourceItems());
    for (const item of pageItems) {
      const pk = item[cfg.partitionKeyName];
      const sk = cfg.sortKeyName ? item[cfg.sortKeyName] : null;
      const key = getItemKey(pk, sk);
      if (checked) {
        selectedItems.add(key);
      } else {
        selectedItems.delete(key);
      }
    }
    renderPage(); // Re-render to update checkbox states
    updateDeleteButtonState();
    updateRestoreButtonState();
  }

  // Helper function to get all selected items from the full dataset
  function getSelectedItems() {
    const sourceItems = getSourceItems();
    return sourceItems.filter(item => {
      const pk = item[cfg.partitionKeyName];
      const sk = cfg.sortKeyName ? item[cfg.sortKeyName] : null;
      return isItemSelected(pk, sk);
    });
  }

  // Helper function to get count of selected items
  function getSelectedCount() {
    return selectedItems.size;
  }

  // Helper function to clear all selections
  function clearSelection() {
    selectedItems.clear();
    renderPage(); // Re-render to update checkbox states
    updateDeleteButtonState();
    updateRestoreButtonState();
  }

  // Update delete button state based on selection and current view
  function updateDeleteButtonState() {
    if (deleteSelectedBtn) {
      // Hide delete button when viewing inactive records
      if (currentStatusFilter === 'inactive') {
        deleteSelectedBtn.style.display = 'none';
        return;
      }
      
      // Show delete button for active records
      deleteSelectedBtn.style.display = '';
      const count = getSelectedCount();
      deleteSelectedBtn.disabled = count === 0;
      if (count > 0) {
        deleteSelectedBtn.textContent = `Delete Selected (${count})`;
      } else {
        deleteSelectedBtn.textContent = "Delete Selected";
      }
    }
  }

  // Update restore button state based on selection and current view
  function updateRestoreButtonState() {
    if (restoreSelectedBtn) {
      // Hide restore button when viewing active records
      if (currentStatusFilter === 'active') {
        restoreSelectedBtn.style.display = 'none';
        return;
      }
      
      // Show restore button for inactive records
      restoreSelectedBtn.style.display = '';
      const count = getSelectedCount();
      restoreSelectedBtn.disabled = count === 0;
      if (count > 0) {
        restoreSelectedBtn.textContent = `Restore Selected (${count})`;
      } else {
        restoreSelectedBtn.textContent = "Restore Selected";
      }
    }
  }

  // Helper function to update select all checkbox state
  function updateSelectAllCheckbox(selectAllCheckbox, items, pkName, skName) {
    if (Array.isArray(items) && items.length > 0) {
      const allSelected = items.every(item => {
        const pk = item[pkName];
        const sk = skName ? item[skName] : null;
        return isItemSelected(pk, sk);
      });
      selectAllCheckbox.checked = allSelected && items.length > 0;
      selectAllCheckbox.indeterminate = !allSelected && items.some(item => {
        const pk = item[pkName];
        const sk = skName ? item[skName] : null;
        return isItemSelected(pk, sk);
      });
    } else {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
    }
  }

  function renderItems(items) {
    itemsTbody.innerHTML = "";
    // Build dynamic columns: pk, sk (if any), plus union of other keys
    const pkName = cfg.partitionKeyName;
    const skName = cfg.sortKeyName;
    
    // Use schema to define column order and display
    const schemaFields = cfg.schema.map(field => field.name);
    
    // Conditionally include/exclude fields based on status filter
    // For active records: show created_at, created_by, updated_at, updated_by, reason_update
    // For inactive records: show created_at, created_by, reason_delete
    let excludedFields;
    
    if (currentStatusFilter === 'active') {
      // For active: exclude only status and reason_delete
      excludedFields = ['status', 'reason_delete'];
    } else {
      // For inactive: exclude status, updated_at, updated_by, reason_update
      excludedFields = ['status', 'updated_at', 'updated_by', 'reason_update'];
    }
    
    // Filter out excluded fields - this will include all schema fields except excluded ones
    // This means for active: created_at, created_by, updated_at, updated_by, reason_update will be included
    // For inactive: created_at, created_by, reason_delete will be included
    const displayFields = schemaFields.filter(field => !excludedFields.includes(field));
    columnOrder = displayFields.slice();
    
    // Debug: log what fields will be displayed
    console.log('Status filter:', currentStatusFilter);
    console.log('Excluded fields:', excludedFields);
    console.log('Display fields:', displayFields);
    
    // Render header
    const headerRow = document.createElement("tr");
    
    // Add checkbox header with "select all" functionality
    const thCheckbox = document.createElement("th");
    thCheckbox.style.width = "40px";
    thCheckbox.style.textAlign = "center";
    const selectAllCheckbox = document.createElement("input");
    selectAllCheckbox.type = "checkbox";
    selectAllCheckbox.title = "Select all";
    selectAllCheckbox.addEventListener("change", (e) => {
      toggleSelectAll(e.target.checked);
    });
    thCheckbox.appendChild(selectAllCheckbox);
    headerRow.appendChild(thCheckbox);
    
    // Render PK and SK first
    const thPk = document.createElement("th"); thPk.textContent = pkName; headerRow.appendChild(thPk);
    if (skName) { const thSk = document.createElement("th"); thSk.textContent = skName; headerRow.appendChild(thSk); }

    // Render other schema fields
    for (const fieldName of displayFields) {
      if (fieldName === pkName || (skName && fieldName === skName)) continue; // Skip PK/SK as they are already added
      const schemaField = cfg.schema.find(f => f.name === fieldName);
      console.log('Processing field:', fieldName, 'Found in schema:', !!schemaField);
      if (schemaField) {
        const th = document.createElement("th");
        th.textContent = schemaField.label || schemaField.name; // Use label if available, otherwise name
        headerRow.appendChild(th);
        console.log('Added header for:', fieldName, 'Label:', th.textContent);
      } else {
        console.warn('Field not found in schema:', fieldName);
      }
    }

    const thActions = document.createElement("th"); thActions.textContent = "Actions"; headerRow.appendChild(thActions);
    itemsThead.innerHTML = "";
    itemsThead.appendChild(headerRow);
    
    // Update select all checkbox state
    updateSelectAllCheckbox(selectAllCheckbox, items, pkName, skName);

    // Populate filter field options for each condition row - needs to use all possible fields
    const selects = conditionsEl.querySelectorAll('select.condition-field');
    selects.forEach((sel) => populateFieldOptions(sel, pkName, skName, displayFields));

    // Render body
    if (!Array.isArray(items) || items.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      const colCount = 1 + 1 + (skName ? 1 : 0) + displayFields.length + 1; // checkbox + pk + sk? + all *displayed* schema fields + actions
      td.colSpan = colCount;
      td.className = "muted";
      td.textContent = "No items found.";
      tr.appendChild(td);
      itemsTbody.appendChild(tr);
      return;
    }

    for (const item of items) {
      const pk = item[pkName];
      const sk = skName ? item[skName] : null;
      const tr = document.createElement("tr");

      // Add checkbox cell
      const tdCheckbox = document.createElement("td");
      tdCheckbox.style.textAlign = "center";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = isItemSelected(pk, sk);
      checkbox.addEventListener("change", () => {
        toggleItemSelection(pk, sk);
        // Update select all checkbox state
        updateSelectAllCheckbox(selectAllCheckbox, items, pkName, skName);
        // Update delete and restore button states
        updateDeleteButtonState();
        updateRestoreButtonState();
      });
      tdCheckbox.appendChild(checkbox);
      tr.appendChild(tdCheckbox);

      const tdPk = document.createElement("td"); tdPk.textContent = valueToString(pk); tr.appendChild(tdPk);
      if (skName) { const tdSk = document.createElement("td"); tdSk.textContent = valueToString(sk); tr.appendChild(tdSk); }

      // Render other schema fields
      for (const fieldName of displayFields) {
        if (fieldName === pkName || (skName && fieldName === skName)) continue; // Skip PK/SK
        const td = document.createElement("td");
        td.textContent = valueToString(item[fieldName]);
        tr.appendChild(td);
      }

      const tdActions = document.createElement("td");
      tdActions.className = "row-actions";
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "secondary";
      editBtn.textContent = "Edit";
      // Pass a minimal attributes object for convenience when opening edit from a row
      const attrsForEdit = Object.fromEntries(Object.entries(item).filter(([k]) => k !== pkName && k !== skName));
      editBtn.addEventListener("click", () => startEdit(pk, sk, attrsForEdit));
      // Remove individual delete button - use global delete instead
      tdActions.appendChild(editBtn);
      tr.appendChild(tdActions);

      itemsTbody.appendChild(tr);
    }
    lastRendered = Array.isArray(items) ? items.slice() : [];
  }

  function valueToString(val) {
    if (val == null) return "";
    if (typeof val === "object") return JSON.stringify(val);
    return String(val);
  }

  function getSourceItems() {
    return Array.isArray(filteredItems) ? filteredItems : allItems;
  }

  function getPageCount(items) {
    const total = Array.isArray(items) ? items.length : 0;
    return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  }

  function getPagedItems(items) {
    if (!Array.isArray(items)) return [];
    const start = (currentPage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }

  function updatePaginationControls(totalItems) {
    const total = Array.isArray(totalItems) ? totalItems.length : 0;
    const totalPages = getPageCount(totalItems);
    if (pageInfo) pageInfo.textContent = `Page ${totalPages === 0 ? 0 : currentPage} / ${totalPages} • ${total} items`;
    if (prevPageBtn) prevPageBtn.disabled = currentPage <= 1;
    if (nextPageBtn) nextPageBtn.disabled = currentPage >= totalPages;
  }

  function renderPage() {
    const src = getSourceItems();
    const totalPages = getPageCount(src);
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    const pageItems = getPagedItems(src);
    renderItems(pageItems);
    updatePaginationControls(src);
    updateDeleteButtonState();
    updateRestoreButtonState();
  }

  async function refresh() {
    setStatus("Loading...");
    console.log('=== REFRESH CALLED ===');
    console.log('Current status filter:', currentStatusFilter);
    try {
      const data = await apiGetList(currentStatusFilter);
      const items = Array.isArray(data)
        ? data
        : (data.items || data.Items || data.suppliers || data.Suppliers || []);
      allItems = items;
      filteredItems = null;
      currentPage = 1;
      console.log('About to render page with', items.length, 'items');
      renderPage();
      setStatus("Loaded.");
    } catch (e) {
      console.error(e);
      setStatus(e.message || "Failed to load", true);
    }
  }

  function applyFilter() {
    const conds = getConditions();
    if (conds.length === 0) { filteredItems = null; currentPage = 1; renderPage(); return; }
    const filtered = allItems.filter((row) => {
      // AND across all conditions
      for (const c of conds) {
        const q = (c.text || "").toLowerCase();
        if (!q) return false; // empty text doesn't match
        if (c.field && c.field !== "__ALL__") {
          const v = valueToString(row[c.field] ?? "").toLowerCase();
          if (v !== q) return false;
        } else {
          // All fields: any field must match this condition
          let any = false;
          for (const k of Object.keys(row)) {
            const v = valueToString(row[k] ?? "").toLowerCase();
            if (v === q) { any = true; break; }
          }
          if (!any) return false;
        }
      }
      return true;
    });
    filteredItems = filtered;
    currentPage = 1;
    renderPage();
  }

  function getConditions() {
    const rows = Array.from(conditionsEl.querySelectorAll('.condition-row'));
    return rows.map((r) => ({
      field: r.querySelector('select.condition-field')?.value,
      text: r.querySelector('input.condition-text')?.value,
    })).filter(Boolean);
  }

  function populateFieldOptions(selectEl, pkName, skName, otherKeys) {
    const prev = selectEl.value;
    selectEl.innerHTML = "";
    const optAll = document.createElement("option"); optAll.value = "__ALL__"; optAll.textContent = "All fields"; selectEl.appendChild(optAll);
    const addOpt = (name) => { const o = document.createElement("option"); o.value = name; o.textContent = name; selectEl.appendChild(o); };
    addOpt(pkName);
    if (skName) addOpt(skName);
    for (const k of otherKeys) addOpt(k);
    // restore previous if exists
    if (prev) selectEl.value = prev;
  }

  function addConditionRow() {
    const row = document.createElement('div');
    row.className = 'condition-row';
    const sel = document.createElement('select'); sel.className = 'condition-field';
    const inp = document.createElement('input'); inp.className = 'condition-text'; inp.placeholder = 'Search here...';
    const del = document.createElement('button'); del.type = 'button'; del.className = 'ghost small-btn'; del.textContent = '-';
    del.addEventListener('click', () => { row.remove(); });
    row.appendChild(sel); row.appendChild(inp); row.appendChild(del);
    conditionsEl.appendChild(row);
    // options will be populated on next renderItems call; also try immediate populate if columns known
    if (columnOrder && columnOrder.length > 0) {
      const pkName = cfg.partitionKeyName; const skName = cfg.sortKeyName; populateFieldOptions(sel, pkName, skName, columnOrder);
    }
  }

  async function downloadCsvFromApi(url, filename) {
    try {
      // For GET requests, we only need Accept header, not Content-Type
      const headers = {};
      // Copy other headers (like API keys) but exclude Content-Type
      if (cfg.requestInit.headers) {
        for (const [key, value] of Object.entries(cfg.requestInit.headers)) {
          if (key.toLowerCase() !== "content-type") {
            headers[key] = value;
          }
        }
      }
      headers["Accept"] = "text/csv";
      console.log("Fetching CSV from:", url);
      console.log("Headers:", headers);
      const res = await fetch(url, {
        method: "GET",
        mode: cfg.requestInit.mode || "cors",
        credentials: cfg.requestInit.credentials || "omit",
        headers,
      });
      console.log("Response status:", res.status, res.statusText);
      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        throw new Error(`Download failed: ${res.status} ${res.statusText} - ${errorText}`);
      }
      const blob = await res.blob();
      console.log("Blob received, size:", blob.size);
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
      return true;
    } catch (e) {
      console.error("downloadCsvFromApi error:", e);
      throw e;
    }
  }

  // Setup download button handlers
  if (downloadAllBtn) {
    console.log("Setting up downloadAllBtn event listener");
    downloadAllBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log("Download All button clicked!");
      setStatus("Downloading all records...");
      downloadAllBtn.disabled = true;
      try {
        const qp = new URLSearchParams();
        if (currentStatusFilter) {
          qp.append('status', currentStatusFilter);
        }
        const url = buildUrl(cfg.endpoints.downloadAll) + (qp.toString() ? `?${qp.toString()}` : '');
        console.log("Download All URL:", url);
        await downloadCsvFromApi(url, `suppliers_all_${Date.now()}.csv`);
        setStatus("Download started.");
      } catch (e) {
        console.error("Download All error:", e);
        setStatus(e.message || "Download failed", true);
      } finally {
        downloadAllBtn.disabled = false;
      }
    });
    console.log("downloadAllBtn event listener attached");
  } else {
    console.error("downloadAllBtn not found - button may not exist in DOM");
  }

  if (downloadFilteredBtn) {
    console.log("Setting up downloadFilteredBtn event listener");
    downloadFilteredBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log("Download Filtered button clicked!");
      const conds = getConditions();
      if (conds.length === 0) {
        setStatus("No filters applied. Use 'Download All' for all records.", true);
        return;
      }
      setStatus("Downloading filtered records...");
      downloadFilteredBtn.disabled = true;
      try {
        const qp = new URLSearchParams();
        // Build query params from filter conditions
        for (const c of conds) {
          if (c.field && c.field !== "__ALL__" && c.text) {
            qp.append(c.field, c.text);
          }
        }
        // Add current status filter
        if (currentStatusFilter) {
          qp.append('status', currentStatusFilter);
        }
        const url = buildUrl(cfg.endpoints.downloadFiltered) + (qp.toString() ? "?" + qp.toString() : "");
        console.log("Download Filtered URL:", url);
        await downloadCsvFromApi(url, `suppliers_filtered_${Date.now()}.csv`);
        setStatus("Download started.");
      } catch (e) {
        console.error("Download Filtered error:", e);
        setStatus(e.message || "Download failed", true);
      } finally {
        downloadFilteredBtn.disabled = false;
      }
    });
    console.log("downloadFilteredBtn event listener attached");
  } else {
    console.error("downloadFilteredBtn not found - button may not exist in DOM");
  }

  function startEdit(pk, sk, attributes) {
    editState = { isEditing: true, pk, sk };
    // Switch UI into update form mode
    currentMode = "update";
    const keyDesc = cfg.sortKeyName ? `${cfg.partitionKeyName}=${pk}, ${cfg.sortKeyName}=${sk}` : `${cfg.partitionKeyName}=${pk}`;
    formTitle.textContent = `Edit Item (${keyDesc})`;
    saveBtn.textContent = "Update";
    cancelEditBtn.classList.remove("hidden");
    if (typeof attributesRow !== "undefined" && attributesRow) attributesRow.classList.remove("hidden");
    if (typeof csvRow !== "undefined" && csvRow) csvRow.classList.add("hidden");
    pkInput.value = pk;
    pkInput.disabled = true;
    if (cfg.sortKeyName && skInput) {
      skInput.value = sk != null ? String(sk) : "";
      skInput.disabled = true;
    }
    // Prefill attributes from row: put first only for convenience, but UI supports multi
    const entries = Object.entries(attributes || {});
    if (entries.length > 0) {
      if (hasSchema()) {
        renderUpdateMultiFieldUI(Object.fromEntries([entries[0]]));
        attributesFields.classList.remove("hidden");
        attributesInput.classList.add("hidden");
      } else {
        const [firstKey, firstVal] = entries[0];
        attributesInput.value = JSON.stringify({ [firstKey]: firstVal }, null, 2);
      }
    } else {
      if (hasSchema()) renderUpdateMultiFieldUI(); else attributesInput.value = "{}";
    }
    setAttributeInputsEnabled(true);
    showSection("form");
  }

  function cancelEdit() {
    editState = { isEditing: false, pk: null, sk: null };
    formTitle.textContent = "Create Item";
    saveBtn.textContent = "Create";
    cancelEditBtn.classList.add("hidden");
    pkInput.disabled = false;
    if (cfg.sortKeyName && skInput) skInput.disabled = false;
    itemForm.reset();
    setAttributeInputsEnabled(true);
  }

  async function onDelete(pk, sk) {
    const keyDesc = cfg.sortKeyName ? `${cfg.partitionKeyName}=${pk}, ${cfg.sortKeyName}=${sk}` : `${cfg.partitionKeyName}=${pk}`;
    const reason = prompt(`Reason for deleting item ${keyDesc}:`);
    if (reason === null) return; // User cancelled the prompt
    
    setStatus("Deleting...");
    try {
      const deleteBody = { [cfg.partitionKeyName]: pk };
      if (cfg.sortKeyName && sk != null) {
        deleteBody[cfg.sortKeyName] = sk;
      }
      deleteBody.reason_delete = reason || 'UI Delete (no reason provided)'; // Use provided reason or a default
      await apiDelete(deleteBody);
      setStatus("Deleted.");
      await refresh();
    } catch (e) {
      console.error(e);
      setStatus(e.message || "Delete failed", true);
    }
  }

  // Bulk delete function for selected items
  async function onBulkDelete() {
    const selected = getSelectedItems();
    if (selected.length === 0) {
      setStatus("Please select at least one item to delete.", true);
      return;
    }

    const count = selected.length;
    const confirmMessage = `Are you sure you want to delete ${count} selected item(s)?`;
    if (!confirm(confirmMessage)) {
      return; // User cancelled
    }

    const reason = prompt(`Reason for deleting ${count} item(s):`);
    if (reason === null) return; // User cancelled the prompt
    if (!reason || reason.trim() === "") {
      setStatus("Deletion reason is required.", true);
      return;
    }

    setStatus(`Deleting ${count} item(s)...`);
    deleteSelectedBtn.disabled = true;
    
    let successCount = 0;
    let failCount = 0;
    const errors = [];

    try {
      // Delete items sequentially to avoid overwhelming the API
      for (const item of selected) {
        try {
          const pk = item[cfg.partitionKeyName];
          const sk = cfg.sortKeyName ? item[cfg.sortKeyName] : null;
          const deleteBody = { [cfg.partitionKeyName]: pk };
          if (cfg.sortKeyName && sk != null) {
            deleteBody[cfg.sortKeyName] = sk;
          }
          deleteBody.reason_delete = reason;
          await apiDelete(deleteBody);
          successCount++;
          // Remove from selected items
          const key = getItemKey(pk, sk);
          selectedItems.delete(key);
        } catch (e) {
          failCount++;
          const pk = item[cfg.partitionKeyName];
          const sk = cfg.sortKeyName ? item[cfg.sortKeyName] : null;
          const keyDesc = cfg.sortKeyName ? `${cfg.partitionKeyName}=${pk}, ${cfg.sortKeyName}=${sk}` : `${cfg.partitionKeyName}=${pk}`;
          errors.push(`${keyDesc}: ${e.message || "Delete failed"}`);
          console.error(`Failed to delete ${keyDesc}:`, e);
        }
      }

      // Show summary
      if (failCount === 0) {
        setStatus(`Successfully deleted ${successCount} item(s).`);
      } else {
        const errorMsg = `Deleted ${successCount} item(s), failed ${failCount} item(s).\nErrors:\n${errors.join('\n')}`;
        setStatus(errorMsg, true);
      }

      // Refresh the list and clear selection
      await refresh();
      selectedItems.clear();
      updateDeleteButtonState();
      updateRestoreButtonState();
    } catch (e) {
      console.error(e);
      setStatus(e.message || "Bulk delete failed", true);
    } finally {
      deleteSelectedBtn.disabled = false;
    }
  }

  // Mode handling
  let currentMode = "idle"; // 'list' | 'create' | 'update' | 'delete'

  function showSection(section) {
    if (section === "table") {
      tableSection.classList.remove("hidden");
      formSection.classList.add("hidden");
    } else if (section === "form") {
      formSection.classList.remove("hidden");
      tableSection.classList.add("hidden");
    }
  }

  viewAllBtn.addEventListener("click", async () => {
    currentMode = "list";
    currentStatusFilter = 'active'; // Set filter to active
    viewAllBtn.className = "secondary"; // Highlight active button
    viewDeletedBtn.className = "ghost"; // Dim inactive button
    showSection("table");
    await refresh();
  });

  viewDeletedBtn.addEventListener("click", async () => {
    currentMode = "list";
    currentStatusFilter = 'inactive'; // Set filter to inactive
    viewDeletedBtn.className = "secondary"; // Highlight inactive button
    viewAllBtn.className = "ghost"; // Dim active button
    showSection("table");
    await refresh();
  });

  createBtn.addEventListener("click", () => {
    cancelEdit();
    currentMode = "create";
    formTitle.textContent = "Create Item";
    saveBtn.textContent = "Create";
    attributesRow.classList.remove("hidden");
    csvRow.classList.remove("hidden");
    if (hasSchema()) { renderAttributeFields(); }
    setAttributeInputsEnabled(true);
    pkInput.disabled = false;
    if (cfg.sortKeyName && skInput) skInput.disabled = false;
    showSection("form");
  });

  updateBtn.addEventListener("click", () => {
    cancelEdit();
    currentMode = "update";
    formTitle.textContent = "Update Item (select fields and values)";
    saveBtn.textContent = "Update";
    attributesRow.classList.remove("hidden");
    csvRow.classList.add("hidden");
    if (hasSchema()) { renderUpdateMultiFieldUI(); }
    setAttributeInputsEnabled(true);
    pkInput.disabled = false;
    if (cfg.sortKeyName && skInput) skInput.disabled = false;
    showSection("form");
  });

  deleteBtn.addEventListener("click", () => {
    cancelEdit();
    currentMode = "delete";
    formTitle.textContent = "Delete Item";
    saveBtn.textContent = "Delete";
    attributesRow.classList.add("hidden");
    csvRow.classList.add("hidden");
    setAttributeInputsEnabled(false);
    pkInput.disabled = false;
    if (cfg.sortKeyName && skInput) skInput.disabled = false;
    showSection("form");
  });

  uploadCsvBtn.addEventListener("click", async () => {
    if (!csvInput.files || csvInput.files.length === 0) { setStatus("Please choose a CSV file", true); return; }
    const file = csvInput.files[0];
    setStatus("Uploading CSV...");
    uploadCsvBtn.disabled = true;
    try {
      await apiBulkCreateCsv(file);
      setStatus("CSV uploaded.");
      csvInput.value = "";
      showSection("table");
      await refresh();
    } catch (e) {
      console.error(e);
      setStatus(e.message || "Bulk upload failed", true);
    } finally {
      uploadCsvBtn.disabled = false;
    }
  });

  // Filter handlers
  applyFilterBtn.addEventListener("click", applyFilter);
  clearFilterBtn.addEventListener("click", () => { conditionsEl.innerHTML = ""; addConditionRow(); filteredItems = null; currentPage = 1; renderPage(); });
  addConditionBtn.addEventListener("click", addConditionRow);

  // Bulk delete handler
  if (deleteSelectedBtn) {
    deleteSelectedBtn.addEventListener("click", onBulkDelete);
    // Initialize button state
    updateDeleteButtonState();
  }

  // Bulk restore function for selected inactive items
  async function onBulkRestore() {
    const selected = getSelectedItems();
    if (selected.length === 0) {
      setStatus("Please select at least one item to restore.", true);
      return;
    }

    const count = selected.length;
    const confirmMessage = `Are you sure you want to restore ${count} selected item(s) to active status?`;
    if (!confirm(confirmMessage)) {
      return; // User cancelled
    }

    const reason = prompt(`Reason for restoring ${count} item(s) to active:`);
    if (reason === null) return; // User cancelled the prompt
    if (!reason || reason.trim() === "") {
      setStatus("Restore reason is required.", true);
      return;
    }

    setStatus(`Restoring ${count} item(s)...`);
    restoreSelectedBtn.disabled = true;
    
    let successCount = 0;
    let failCount = 0;
    const errors = [];

    try {
      // Restore items sequentially to avoid overwhelming the API
      for (const item of selected) {
        try {
          const pk = item[cfg.partitionKeyName];
          const sk = cfg.sortKeyName ? item[cfg.sortKeyName] : null;
          
          // Update status to 'active' and add reason
          const updateAttrs = {
            status: 'active',
            reason_update: reason
          };
          
          await apiUpdate(pk, sk, updateAttrs);
          successCount++;
          // Remove from selected items
          const key = getItemKey(pk, sk);
          selectedItems.delete(key);
        } catch (e) {
          failCount++;
          const pk = item[cfg.partitionKeyName];
          const sk = cfg.sortKeyName ? item[cfg.sortKeyName] : null;
          const keyDesc = cfg.sortKeyName ? `${cfg.partitionKeyName}=${pk}, ${cfg.sortKeyName}=${sk}` : `${cfg.partitionKeyName}=${pk}`;
          errors.push(`${keyDesc}: ${e.message || "Restore failed"}`);
          console.error(`Failed to restore ${keyDesc}:`, e);
        }
      }

      // Show summary
      if (failCount === 0) {
        setStatus(`Successfully restored ${successCount} item(s) to active.`);
      } else {
        const errorMsg = `Restored ${successCount} item(s), failed ${failCount} item(s).\nErrors:\n${errors.join('\n')}`;
        setStatus(errorMsg, true);
      }

      // Refresh the list and clear selection
      await refresh();
      selectedItems.clear();
      updateDeleteButtonState();
      updateRestoreButtonState();
    } catch (e) {
      console.error(e);
      setStatus(e.message || "Bulk restore failed", true);
    } finally {
      restoreSelectedBtn.disabled = false;
    }
  }

  // Bulk restore handler
  if (restoreSelectedBtn) {
    restoreSelectedBtn.addEventListener("click", onBulkRestore);
    // Initialize button state
    updateRestoreButtonState();
  }

  // Start with one empty condition row
  addConditionRow();

  itemForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const pk = pkInput.value.trim();
    const sk = cfg.sortKeyName ? (skInput.value.trim()) : null;
    if (!pk) { setStatus("Partition key is required", true); return; }
    if (cfg.sortKeyName && !sk) { setStatus("Sort key is required", true); return; }
    let attrs;
    try {
      attrs = hasSchema() ? getAttributesFromForm(currentMode === "update") : safeParseJson(attributesInput.value);
    } catch (e) { setStatus(e.message, true); return; }
    const isEditFromRow = editState.isEditing && currentMode !== "delete";
    const action = currentMode === "delete" ? "delete" : (isEditFromRow || currentMode === "update" ? "update" : "create");
    setStatus(action === "delete" ? "Deleting..." : action === "update" ? "Updating..." : "Creating...");
    saveBtn.disabled = true;
    try {
      if (action === "delete") {
        const keyDesc = cfg.sortKeyName ? `${cfg.partitionKeyName}=${pk}, ${cfg.sortKeyName}=${sk}` : `${cfg.partitionKeyName}=${pk}`;
        const reason = prompt(`Reason for deleting item ${keyDesc}:`);
        if (reason === null) return; // User cancelled the prompt

        const deleteBody = { [cfg.partitionKeyName]: pk };
        if (cfg.sortKeyName && sk != null) {
          deleteBody[cfg.sortKeyName] = sk;
        }
        deleteBody.reason_delete = reason || 'UI Delete (no reason provided from form)'; // Use provided reason or a default
        await apiDelete(deleteBody);
        setStatus("Deleted.");
        itemForm.reset();
        showSection("table");
        await refresh();
      } else if (action === "update") {
        const targetPk = isEditFromRow ? editState.pk : pk;
        const targetSk = isEditFromRow ? editState.sk : sk;

        const keyDesc = cfg.sortKeyName ? `${cfg.partitionKeyName}=${targetPk}, ${cfg.sortKeyName}=${targetSk}` : `${cfg.partitionKeyName}=${targetPk}`;
        const reason = prompt(`Reason for updating item ${keyDesc}:`);
        if (reason === null) return; // User cancelled the prompt
        attrs.reason_update = reason || 'UI Update (no reason provided from form)'; // Use provided reason or a default

        await apiUpdate(targetPk, targetSk, attrs);
        setStatus("Updated.");
        cancelEdit();
        showSection("table");
        await refresh();
      } else {
        await apiCreate(pk, sk, attrs);
        setStatus("Created.");
        itemForm.reset();
      }
    } catch (e) {
      console.error(e);
      setStatus(e.message || "Operation failed", true);
    } finally {
      saveBtn.disabled = false;
    }
  });

  cancelEditBtn.addEventListener("click", cancelEdit);

  // Pagination controls
  if (pageSizeSelect) {
    pageSizeSelect.addEventListener("change", () => {
      const n = Number(pageSizeSelect.value);
      if (Number.isFinite(n) && n > 0) {
        pageSize = n;
        currentPage = 1;
        renderPage();
      }
    });
  }
  if (prevPageBtn) {
    prevPageBtn.addEventListener("click", () => {
      if (currentPage > 1) {
        currentPage -= 1;
        renderPage();
      }
    });
  }
  if (nextPageBtn) {
    nextPageBtn.addEventListener("click", () => {
      const totalPages = getPageCount(getSourceItems());
      if (currentPage < totalPages) {
        currentPage += 1;
        renderPage();
      }
    });
  }

  // Function to generate token and update config
  async function initializeToken() {
    try {
      const tokenUrl = buildUrl(cfg.endpoints.generateToken);
      const tokenRes = await fetch(tokenUrl, { method: "POST" });
      if (!tokenRes.ok) {
        throw new Error(`Failed to generate token: ${tokenRes.status}`);
      }
      const { token } = await tokenRes.json();
      cfg.requestInit.headers = { ...cfg.requestInit.headers, Authorization: `Bearer ${token}` };
      console.log("Token generated and applied.");
    } catch (e) {
      console.error("Token initialization failed:", e);
      setStatus(e.message || "Failed to initialize token", true);
    }
  }

  // Call initializeToken at the start of the application
  // initializeToken().then(() => {
  //   // After token is initialized, refresh the list if needed
  //   // if (currentMode === "list") {
  //   //   refresh();
  //   // }
  // });

  // Initial: wait for a button click; no auto-load

  // Field-based multi-update UI
  function createUpdateRow(schema, preset) {
    const row = document.createElement("div"); row.className = "form-row update-row";
    const sel = document.createElement("select"); sel.className = "update-field";
    for (const f of schema) { const opt = document.createElement("option"); opt.value = f.name; opt.textContent = f.label || f.name; sel.appendChild(opt); }
    const input = document.createElement("input"); input.className = "update-value"; input.type = "text";
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "ghost small-btn"; btn.textContent = "-";
    btn.addEventListener("click", () => { row.remove(); });

    function syncType() {
      const f = schema.find(s => s.name === sel.value);
      const t = f && f.type; input.type = t === "number" ? "number" : t === "date" ? "date" : t === "email" ? "email" : "text";
      input.placeholder = f && f.placeholder ? f.placeholder : "";
    }
    sel.addEventListener("change", syncType);

    if (preset) { sel.value = preset.name; input.value = preset.value; }
    syncType();

    row.appendChild(sel); row.appendChild(input); row.appendChild(btn);
    return row;
  }

  function renderUpdateMultiFieldUI(prefills) {
    if (!hasSchema()) { attributesFields.classList.add("hidden"); attributesInput.classList.remove("hidden"); return; }
    const schema = getFilteredSchema();
    attributesFields.innerHTML = "";
    const label = document.createElement("label"); label.textContent = "Select field(s) and provide value"; attributesFields.appendChild(label);
    const list = document.createElement("div"); list.id = "updateRows"; list.className = "form-row"; attributesFields.appendChild(list);
    const actions = document.createElement("div"); actions.className = "form-actions"; attributesFields.appendChild(actions);
    const addBtn = document.createElement("button"); addBtn.type = "button"; addBtn.className = "secondary"; addBtn.textContent = "+ Add another field"; actions.appendChild(addBtn);
    addBtn.addEventListener("click", () => { list.appendChild(createUpdateRow(schema)); });

    // initial rows
    if (prefills && typeof prefills === "object" && Object.keys(prefills).length > 0) {
      const [k, v] = Object.entries(prefills)[0];
      list.appendChild(createUpdateRow(schema, { name: k, value: v }));
    } else {
      list.appendChild(createUpdateRow(schema));
    }

    attributesFields.classList.remove("hidden");
    attributesInput.classList.add("hidden");
  }
})();


