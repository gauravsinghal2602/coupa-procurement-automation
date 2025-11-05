(function () {
  const defaultConfig = {
    baseUrl: "",
    // For composite keys, set both. If only partitionKeyName is set, app will treat as single key.
    partitionKeyName: "id",
    sortKeyName: null, // e.g., "sk"
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

  const el = (id) => document.getElementById(id);
  const statusEl = el("status");
  const viewAllBtn = el("viewAllBtn");
  const createBtn = el("createBtn");
  const updateBtn = el("updateBtn");
  const deleteBtn = el("deleteBtn");
  const itemsTbody = el("itemsTbody");
  const itemsThead = el("itemsThead");
  const filterField = el("filterField");
  const filterText = el("filterText");
  const applyFilterBtn = el("applyFilterBtn");
  const clearFilterBtn = el("clearFilterBtn");
  const downloadAllBtn = el("downloadAllBtn");
  const downloadFilteredBtn = el("downloadFilteredBtn");
  const itemForm = el("itemForm");
  const pkInput = el("pkInput");
  const skInput = el("skInput");
  const attributesInput = el("attributesInput");
  const attributesRow = el("attributesRow");
  const formTitle = el("formTitle");
  const saveBtn = el("saveBtn");
  const cancelEditBtn = el("cancelEditBtn");
  const formSection = document.getElementById("formSection");
  const tableSection = document.getElementById("tableSection");
  const pkHeader = el("pkHeader");
  const skHeader = el("skHeader");
  const pkLabel = document.getElementById("pkLabel");
  const skLabel = document.getElementById("skLabel");
  const skRow = document.getElementById("skRow");

  // Configure labels/visibility based on keys
  pkHeader.textContent = cfg.partitionKeyName || "Partition Key";
  pkLabel.textContent = cfg.partitionKeyName || "Partition Key";
  if (cfg.sortKeyName) {
    skHeader.textContent = cfg.sortKeyName;
    skLabel.textContent = cfg.sortKeyName;
    skRow.classList.remove("hidden");
    skInput.required = true;
  } else {
    skRow.classList.add("hidden");
    if (skInput) skInput.required = false;
  }
  // Initial state: hide sections until an action is chosen
  formSection.classList.add("hidden");
  tableSection.classList.add("hidden");

  let editState = { isEditing: false, pk: null, sk: null };
  let allItems = [];
  let columnOrder = [];
  let lastRendered = [];

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

  async function apiGetList() {
    const url = buildUrl(cfg.endpoints.list);
    const res = await fetch(url, { ...cfg.requestInit, method: "GET" });
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

  async function apiUpdate(pk, sk, attributes) {
    const url = buildUrl(cfg.endpoints.update);
    const body = buildPatchBody(pk, sk, attributes);
    const res = await fetch(url, { ...cfg.requestInit, method: "PATCH", body });
    if (!res.ok) throw new Error(`Update failed: ${res.status}`);
    return res.json().catch(() => ({}));
  }

  async function apiDelete(pk, sk) {
    const url = buildUrl(cfg.endpoints.delete);
    const body = buildBody(pk, sk, {});
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
    const keys = attributes ? Object.keys(attributes) : [];
    if (keys.length !== 1) {
      throw new Error("For PATCH, provide exactly one attribute to update.");
    }
    const onlyKey = keys[0];
    payload.updateKey = onlyKey;
    payload.updateValue = attributes[onlyKey];
    return JSON.stringify(payload);
  }

  function safeParseJson(str) {
    if (!str || !str.trim()) return {};
    try { return JSON.parse(str); } catch (e) { throw new Error("Attributes must be valid JSON"); }
  }

  function renderItems(items) {
    itemsTbody.innerHTML = "";
    // Build dynamic columns: pk, sk (if any), plus union of other keys
    const pkName = cfg.partitionKeyName;
    const skName = cfg.sortKeyName;
    let otherKeys = columnOrder;
    if (!otherKeys || otherKeys.length === 0) {
      const otherKeysSet = new Set();
      if (Array.isArray(items)) {
        for (const it of items) {
          if (!it || typeof it !== "object") continue;
          for (const k of Object.keys(it)) {
            if (k === pkName || (skName && k === skName)) continue;
            otherKeysSet.add(k);
          }
        }
      }
      otherKeys = Array.from(otherKeysSet);
      columnOrder = otherKeys.slice();
    }

    // Render header
    const headerRow = document.createElement("tr");
    const thPk = document.createElement("th"); thPk.textContent = pkName; headerRow.appendChild(thPk);
    if (skName) { const thSk = document.createElement("th"); thSk.textContent = skName; headerRow.appendChild(thSk); }
    for (const k of otherKeys) { const th = document.createElement("th"); th.textContent = k; headerRow.appendChild(th); }
    const thActions = document.createElement("th"); thActions.textContent = "Actions"; headerRow.appendChild(thActions);
    itemsThead.innerHTML = "";
    itemsThead.appendChild(headerRow);
    // Populate filter field options
    filterField.innerHTML = "";
    const optAll = document.createElement("option"); optAll.value = "__ALL__"; optAll.textContent = "All fields"; filterField.appendChild(optAll);
    const addOpt = (name) => { const o = document.createElement("option"); o.value = name; o.textContent = name; filterField.appendChild(o); };
    addOpt(pkName);
    if (skName) addOpt(skName);
    for (const k of otherKeys) addOpt(k);

    // Render body
    if (!Array.isArray(items) || items.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      const colCount = 1 + (skName ? 1 : 0) + otherKeys.length + 1; // pk + sk? + others + actions
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

      const tdPk = document.createElement("td"); tdPk.textContent = valueToString(pk); tr.appendChild(tdPk);
      if (skName) { const tdSk = document.createElement("td"); tdSk.textContent = valueToString(sk); tr.appendChild(tdSk); }

      for (const k of otherKeys) {
        const td = document.createElement("td");
        td.textContent = valueToString(item[k]);
        tr.appendChild(td);
      }

      const tdActions = document.createElement("td");
      tdActions.className = "row-actions";
      const editBtn = document.createElement("button");
      editBtn.className = "secondary";
      editBtn.textContent = "Edit";
      // Pass a minimal attributes object for convenience when opening edit from a row
      const attrsForEdit = Object.fromEntries(Object.entries(item).filter(([k]) => k !== pkName && k !== skName));
      editBtn.addEventListener("click", () => startEdit(pk, sk, attrsForEdit));
      const delBtn = document.createElement("button");
      delBtn.className = "danger";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", () => onDelete(pk, sk));
      tdActions.appendChild(editBtn);
      tdActions.appendChild(delBtn);
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

  async function refresh() {
    setStatus("Loading...");
    try {
      const data = await apiGetList();
      const items = Array.isArray(data)
        ? data
        : (data.items || data.Items || data.suppliers || data.Suppliers || []);
      allItems = items;
      renderItems(allItems);
      setStatus("Loaded.");
    } catch (e) {
      console.error(e);
      setStatus(e.message || "Failed to load", true);
    }
  }

  function applyFilter() {
    const q = (filterText.value || "").toLowerCase();
    const field = filterField.value;
    if (!q) { renderItems(allItems); return; }
    const filtered = allItems.filter((row) => {
      if (field && field !== "__ALL__") {
        const v = valueToString(row[field] ?? "").toLowerCase();
        return v.includes(q);
      }
      // All fields: check all values
      for (const k of Object.keys(row)) {
        const v = valueToString(row[k] ?? "").toLowerCase();
        if (v.includes(q)) return true;
      }
      return false;
    });
    renderItems(filtered);
  }

  function toCsvValue(value) {
    const s = value == null ? "" : (typeof value === "object" ? JSON.stringify(value) : String(value));
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function downloadCsv(rows) {
    const pkName = cfg.partitionKeyName;
    const skName = cfg.sortKeyName;
    const cols = [pkName].concat(skName ? [skName] : []).concat(columnOrder);
    const header = cols.map(toCsvValue).join(",");
    const lines = [header];
    for (const r of rows) {
      const line = cols.map((c) => toCsvValue(r[c])).join(",");
      lines.push(line);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `suppliers_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  downloadAllBtn.addEventListener("click", () => {
    if (!allItems || allItems.length === 0) { setStatus("No data to export", true); return; }
    downloadCsv(allItems);
  });
  downloadFilteredBtn.addEventListener("click", () => {
    if (!lastRendered || lastRendered.length === 0) { setStatus("No filtered data to export", true); return; }
    downloadCsv(lastRendered);
  });

  function startEdit(pk, sk, attributes) {
    editState = { isEditing: true, pk, sk };
    const keyDesc = cfg.sortKeyName ? `${cfg.partitionKeyName}=${pk}, ${cfg.sortKeyName}=${sk}` : `${cfg.partitionKeyName}=${pk}`;
    formTitle.textContent = `Edit Item (${keyDesc})`;
    saveBtn.textContent = "Update";
    cancelEditBtn.classList.remove("hidden");
    pkInput.value = pk;
    pkInput.disabled = true;
    if (cfg.sortKeyName && skInput) {
      skInput.value = sk != null ? String(sk) : "";
      skInput.disabled = true;
    }
    attributesInput.value = JSON.stringify(attributes || {}, null, 2);
  }

  function cancelEdit() {
    editState = { isEditing: false, pk: null, sk: null };
    formTitle.textContent = "Create Item";
    saveBtn.textContent = "Create";
    cancelEditBtn.classList.add("hidden");
    pkInput.disabled = false;
    if (cfg.sortKeyName && skInput) skInput.disabled = false;
    itemForm.reset();
  }

  async function onDelete(pk, sk) {
    const keyDesc = cfg.sortKeyName ? `${cfg.partitionKeyName}=${pk}, ${cfg.sortKeyName}=${sk}` : `${cfg.partitionKeyName}=${pk}`;
    if (!confirm(`Delete item ${keyDesc}?`)) return;
    setStatus("Deleting...");
    try {
      await apiDelete(pk, sk);
      setStatus("Deleted.");
      await refresh();
    } catch (e) {
      console.error(e);
      setStatus(e.message || "Delete failed", true);
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
    showSection("table");
    await refresh();
  });

  createBtn.addEventListener("click", () => {
    currentMode = "create";
    formTitle.textContent = "Create Item";
    saveBtn.textContent = "Create";
    attributesRow.classList.remove("hidden");
    pkInput.disabled = false;
    if (cfg.sortKeyName && skInput) skInput.disabled = false;
    cancelEdit();
    showSection("form");
  });

  updateBtn.addEventListener("click", () => {
    currentMode = "update";
    formTitle.textContent = "Update Item (enter exactly one attribute)";
    saveBtn.textContent = "Update";
    attributesRow.classList.remove("hidden");
    pkInput.disabled = false;
    if (cfg.sortKeyName && skInput) skInput.disabled = false;
    cancelEdit();
    showSection("form");
  });

  deleteBtn.addEventListener("click", () => {
    currentMode = "delete";
    formTitle.textContent = "Delete Item";
    saveBtn.textContent = "Delete";
    attributesRow.classList.add("hidden");
    pkInput.disabled = false;
    if (cfg.sortKeyName && skInput) skInput.disabled = false;
    cancelEdit();
    showSection("form");
  });

  // Filter handlers
  applyFilterBtn.addEventListener("click", applyFilter);
  clearFilterBtn.addEventListener("click", () => { filterText.value = ""; filterField.value = "__ALL__"; renderItems(allItems); });

  itemForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const pk = pkInput.value.trim();
    const sk = cfg.sortKeyName ? (skInput.value.trim()) : null;
    if (!pk) { setStatus("Partition key is required", true); return; }
    if (cfg.sortKeyName && !sk) { setStatus("Sort key is required", true); return; }
    let attrs;
    try { attrs = safeParseJson(attributesInput.value); } catch (e) { setStatus(e.message, true); return; }
    const isEditFromRow = editState.isEditing && currentMode !== "delete";
    const action = currentMode === "delete" ? "delete" : (isEditFromRow || currentMode === "update" ? "update" : "create");
    setStatus(action === "delete" ? "Deleting..." : action === "update" ? "Updating..." : "Creating...");
    saveBtn.disabled = true;
    try {
      if (action === "delete") {
        await apiDelete(pk, sk);
        setStatus("Deleted.");
        itemForm.reset();
        showSection("table");
        await refresh();
      } else if (action === "update") {
        const targetPk = isEditFromRow ? editState.pk : pk;
        const targetSk = isEditFromRow ? editState.sk : sk;
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

  // Initial: wait for a button click; no auto-load
})();


