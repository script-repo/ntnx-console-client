import RFB from "/vendor/novnc/core/rfb.js";
import keysymdef from "/vendor/novnc/core/input/keysymdef.js";

// =====================================================================
// DOM references
// =====================================================================

const loginScreen = document.getElementById("loginScreen");
const loginForm = document.getElementById("loginForm");
const loginPcHostInput = document.getElementById("loginPcHost");
const loginUsernameInput = document.getElementById("loginUsername");
const loginPasswordInput = document.getElementById("loginPassword");
const loginRememberInput = document.getElementById("loginRemember");
const loginAllowTlsInput = document.getElementById("loginAllowTls");
const loginIncludeHiddenInput = document.getElementById("loginIncludeHidden");
const loginSubmitBtn = document.getElementById("loginSubmit");
const loginErrorEl = document.getElementById("loginError");

const appShell = document.getElementById("appShell");
const sessionInfo = document.getElementById("sessionInfo");
const sessionUserLabel = document.getElementById("sessionUserLabel");
const logoutBtn = document.getElementById("logoutBtn");
const forgetPeCredsBtn = document.getElementById("forgetPeCredsBtn");

const nameFilterInput = document.getElementById("nameFilter");
const powerStateFilter = document.getElementById("powerStateFilter");
const favoritesTreeEl = document.getElementById("favoritesTree");
const vmListEl = document.getElementById("vmList");
const addFavFolderBtn = document.getElementById("addFavFolderBtn");

const statusEl = document.getElementById("status");
const consoleTabsEl = document.getElementById("consoleTabs");
const screenStageEl = document.getElementById("screenStage");
const consoleEmptyEl = document.getElementById("consoleEmpty");
const showAllBtn = document.getElementById("showAllBtn");
const closeAllBtn = document.getElementById("closeAllBtn");
const wallOfEyesBtn = document.getElementById("wallOfEyesBtn");
const ctrlAltDelBtn = document.getElementById("ctrlAltDelBtn");
const pasteBtn = document.getElementById("pasteBtn");
const consolePasteBtn = document.getElementById("consolePasteBtn");
const consoleGridOverlay = document.getElementById("consoleGridOverlay");
const consoleGridEl = document.getElementById("consoleGrid");
const ctxMenu = document.getElementById("ctxMenu");

const peCredsModal = document.getElementById("peCredsModal");
const peCredsHostLabel = document.getElementById("peCredsHost");
const peCredsHostInput = document.getElementById("peCredsHostInput");
const peCredsUsernameInput = document.getElementById("peCredsUsername");
const peCredsPasswordInput = document.getElementById("peCredsPassword");
const peCredsErrorEl = document.getElementById("peCredsError");
const peCredsCancelBtn = document.getElementById("peCredsCancel");
const peCredsSaveBtn = document.getElementById("peCredsSave");

// =====================================================================
// Storage keys
// =====================================================================

const profileStorageKey = "ntnxConsoleProfile";
const favoritesStorageKey = "ntnxConsoleFavorites";

// =====================================================================
// State
// =====================================================================

// Active session credentials. Held in memory only -- never written to
// localStorage and cleared on logout.
const session = {
  pcHost: "",
  username: "",
  password: "",
  tlsSkipVerify: true,
  includeHiddenVms: true,
  loggedIn: false
};

// Set of PE hosts the NRCC server currently has cached credentials for.
let serverPeHosts = new Set();

let vmCache = [];
let isLoadingVms = false;

// Favorites store (persisted to localStorage):
//   vmMeta: { [uuid]: snapshot of last-known VM metadata }
//   folders: { [folderId]: { id, name, parentId } }
//   placement: { [uuid|folderId]: containerId } where containerId is "__root" or a folder id
//   ordering: { [containerId]: ['vm:<uuid>'|'folder:<id>', ...] }
//   collapsed: { [folderId]: true } - persisted expanded/collapsed state
const favStore = {
  vmMeta: {},
  folders: {},
  placement: {},
  ordering: { __root: [] },
  collapsed: {}
};

// Open console sessions
let consoleSessions = [];
let activeSessionId = null;

// The Wall of Eyes popup reads our open consoles by reaching back through
// `window.opener.consoleSessions`. ES modules are scoped, so explicitly
// publish it on the window object for cross-window access.
window.consoleSessions = consoleSessions;

// Reference to the currently-open Wall of Eyes popup window, if any.
let wallOfEyesWindow = null;

// =====================================================================
// Utilities
// =====================================================================

function setStatus(message, opts = {}) {
  statusEl.innerHTML = "";
  if (opts.spinner) {
    const sp = document.createElement("span");
    sp.className = "spinner";
    statusEl.appendChild(sp);
  }
  const txt = document.createElement("span");
  txt.textContent = message;
  statusEl.appendChild(txt);
}

function loadSavedProfile() {
  try {
    const raw = localStorage.getItem(profileStorageKey);
    if (!raw) return;
    const profile = JSON.parse(raw);
    if (profile?.pcHost) loginPcHostInput.value = profile.pcHost;
    if (profile?.username) loginUsernameInput.value = profile.username;
    loginRememberInput.checked = true;
  } catch (_error) {
    localStorage.removeItem(profileStorageKey);
  }
}

function persistProfileIfNeeded(pcHost, username) {
  if (loginRememberInput.checked) {
    localStorage.setItem(profileStorageKey, JSON.stringify({ pcHost, username }));
  } else {
    localStorage.removeItem(profileStorageKey);
  }
}

// =====================================================================
// Favorites store: load / persist / mutate
// =====================================================================

function migrateLegacyFavorites() {
  // Older versions stored just an array of UUIDs under
  // "ntnxConsoleFavoriteVms". Promote them to the new tree.
  const legacyKey = "ntnxConsoleFavoriteVms";
  try {
    const raw = localStorage.getItem(legacyKey);
    if (!raw) return;
    const ids = JSON.parse(raw);
    if (!Array.isArray(ids)) return;
    ids.forEach((uuid) => {
      if (!favStore.placement[uuid]) {
        favStore.placement[uuid] = "__root";
        favStore.ordering.__root.push(`vm:${uuid}`);
        favStore.vmMeta[uuid] = favStore.vmMeta[uuid] || { name: uuid };
      }
    });
    localStorage.removeItem(legacyKey);
    persistFavorites();
  } catch (_error) {
    /* ignore */
  }
}

function loadFavoritesStore() {
  try {
    const raw = localStorage.getItem(favoritesStorageKey);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && typeof data === "object") {
        favStore.vmMeta = data.vmMeta && typeof data.vmMeta === "object" ? data.vmMeta : {};
        favStore.folders = data.folders && typeof data.folders === "object" ? data.folders : {};
        favStore.placement = data.placement && typeof data.placement === "object" ? data.placement : {};
        favStore.ordering = data.ordering && typeof data.ordering === "object" ? data.ordering : { __root: [] };
        favStore.collapsed = data.collapsed && typeof data.collapsed === "object" ? data.collapsed : {};
        if (!Array.isArray(favStore.ordering.__root)) favStore.ordering.__root = [];
      }
    }
  } catch (_error) {
    localStorage.removeItem(favoritesStorageKey);
  }
  migrateLegacyFavorites();
  // Repair any "folder:<id>" orphan buckets that an earlier bug created
  // when items were dropped into a folder. Merge them back into the
  // correctly-keyed (bare folder id) bucket and rewrite stray placement
  // values that point at "folder:<id>" so they reference the bare id too.
  Object.keys(favStore.ordering).forEach((key) => {
    if (key.startsWith("folder:")) {
      const realKey = key.slice("folder:".length);
      if (!Array.isArray(favStore.ordering[realKey])) {
        favStore.ordering[realKey] = [];
      }
      favStore.ordering[realKey].push(...favStore.ordering[key]);
      delete favStore.ordering[key];
    }
  });
  Object.keys(favStore.placement).forEach((id) => {
    const cur = favStore.placement[id];
    if (typeof cur === "string" && cur.startsWith("folder:")) {
      favStore.placement[id] = cur.slice("folder:".length);
      const folder = favStore.folders[id];
      if (folder) folder.parentId = favStore.placement[id];
    }
  });
  // Ensure every folder has an ordering bucket
  Object.keys(favStore.folders).forEach((fid) => {
    if (!Array.isArray(favStore.ordering[fid])) favStore.ordering[fid] = [];
  });
  persistFavorites();
}

function persistFavorites() {
  localStorage.setItem(favoritesStorageKey, JSON.stringify(favStore));
}

function isFavorite(uuid) {
  return Object.prototype.hasOwnProperty.call(favStore.placement, uuid);
}

function addFavorite(vm) {
  if (!vm || !vm.uuid) return;
  favStore.vmMeta[vm.uuid] = snapshotVm(vm);
  if (!favStore.placement[vm.uuid]) {
    favStore.placement[vm.uuid] = "__root";
    favStore.ordering.__root.push(`vm:${vm.uuid}`);
  }
  persistFavorites();
}

function removeFavorite(uuid) {
  const container = favStore.placement[uuid];
  if (container && Array.isArray(favStore.ordering[container])) {
    favStore.ordering[container] = favStore.ordering[container].filter(
      (entry) => entry !== `vm:${uuid}`
    );
  }
  delete favStore.placement[uuid];
  delete favStore.vmMeta[uuid];
  persistFavorites();
}

function snapshotVm(vm) {
  return {
    name: vm.name,
    uuid: vm.uuid,
    ipAddress: vm.ipAddress || null,
    powerState: vm.powerState || null,
    peHost: vm.peHost || null,
    isControllerVm: !!vm.isControllerVm,
    isFsvm: !!vm.isFsvm,
    isHidden: !!vm.isHidden,
    cvmIp: vm.cvmIp || null,
    cvmName: vm.cvmName || null,
    consoleSupported: vm.consoleSupported,
    categories: vm.categories || []
  };
}

function refreshFavoriteSnapshots() {
  // Any favorited VM that is now in the live list gets its snapshot
  // updated so the favorites pane shows fresh metadata next time.
  let dirty = false;
  vmCache.forEach((vm) => {
    if (isFavorite(vm.uuid)) {
      favStore.vmMeta[vm.uuid] = snapshotVm(vm);
      dirty = true;
    }
  });
  if (dirty) persistFavorites();
}

function createFolder(parentId = "__root", name = "New folder") {
  const id = `f-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  favStore.folders[id] = { id, name, parentId };
  favStore.placement[id] = parentId;
  favStore.ordering[id] = [];
  if (!Array.isArray(favStore.ordering[parentId])) favStore.ordering[parentId] = [];
  favStore.ordering[parentId].push(`folder:${id}`);
  persistFavorites();
  return id;
}

function renameFolder(folderId, newName) {
  if (!favStore.folders[folderId]) return;
  favStore.folders[folderId].name = newName.trim() || "Untitled";
  persistFavorites();
}

function deleteFolder(folderId) {
  if (!favStore.folders[folderId]) return;
  // Move contents up to parent (don't delete the favorited VMs).
  const parentId = favStore.folders[folderId].parentId || "__root";
  const children = (favStore.ordering[folderId] || []).slice();
  children.forEach((entry) => {
    const [type, id] = entry.split(":");
    favStore.placement[id] = parentId;
    if (type === "folder") {
      favStore.folders[id].parentId = parentId;
    }
    if (!Array.isArray(favStore.ordering[parentId])) favStore.ordering[parentId] = [];
    favStore.ordering[parentId].push(entry);
  });
  // Remove folder from its parent's ordering
  if (Array.isArray(favStore.ordering[parentId])) {
    favStore.ordering[parentId] = favStore.ordering[parentId].filter(
      (entry) => entry !== `folder:${folderId}`
    );
  }
  delete favStore.ordering[folderId];
  delete favStore.folders[folderId];
  delete favStore.placement[folderId];
  persistFavorites();
}

function isDescendantFolder(maybeAncestorId, folderId) {
  // Returns true if folderId is the same as, or a descendant of,
  // maybeAncestorId. Used to prevent dropping a folder into itself or
  // one of its own children.
  let cur = folderId;
  while (cur && cur !== "__root") {
    if (cur === maybeAncestorId) return true;
    const f = favStore.folders[cur];
    if (!f) break;
    cur = f.parentId || "__root";
  }
  return false;
}

function moveItemTo(item, destContainerId) {
  // item: 'vm:<uuid>' or 'folder:<id>'
  const [type, id] = item.split(":");
  if (type === "folder" && isDescendantFolder(id, destContainerId)) {
    return false; // illegal: would create a cycle
  }
  const fromContainer = favStore.placement[id];
  if (fromContainer === destContainerId && Array.isArray(favStore.ordering[fromContainer])) {
    // Already in the target container; nothing to do.
    if (favStore.ordering[fromContainer].includes(item)) return false;
  }
  if (fromContainer && Array.isArray(favStore.ordering[fromContainer])) {
    favStore.ordering[fromContainer] = favStore.ordering[fromContainer].filter(
      (e) => e !== item
    );
  }
  favStore.placement[id] = destContainerId;
  if (type === "folder" && favStore.folders[id]) {
    favStore.folders[id].parentId = destContainerId;
  }
  if (!Array.isArray(favStore.ordering[destContainerId])) {
    favStore.ordering[destContainerId] = [];
  }
  favStore.ordering[destContainerId].push(item);

  // If the moved item is a VM and we don't have a snapshot yet (because it
  // was dragged in from the main VM list and was never starred), capture one
  // now so the favorites pane keeps working across reloads.
  if (type === "vm" && !favStore.vmMeta[id]) {
    const live = getVmByUuid(id);
    if (live) favStore.vmMeta[id] = snapshotVm(live);
  }

  // If we dropped into a folder, expand it so the user actually sees the
  // result of their drop.
  if (destContainerId !== "__root" && favStore.folders[destContainerId]) {
    delete favStore.collapsed[destContainerId];
  }
  persistFavorites();
  return true;
}

function getFavoriteVmSnapshot(uuid) {
  // Prefer the live VM if loaded; fall back to the persisted snapshot.
  return getVmByUuid(uuid) || favStore.vmMeta[uuid] || { uuid, name: uuid };
}

function setFolderCollapsed(folderId, collapsed) {
  if (!favStore.folders[folderId]) return;
  if (collapsed) {
    favStore.collapsed[folderId] = true;
  } else {
    delete favStore.collapsed[folderId];
  }
  persistFavorites();
}

function isFolderCollapsed(folderId) {
  return !!favStore.collapsed[folderId];
}

function collectVmUuidsInFolder(folderId) {
  // Returns every VM uuid contained in the folder and all sub-folders, in
  // tree order. Used by the "Launch All" button.
  const out = [];
  const walk = (containerId) => {
    const ordering = favStore.ordering[containerId] || [];
    ordering.forEach((entry) => {
      const [type, id] = entry.split(":");
      if (type === "vm") {
        out.push(id);
      } else if (type === "folder") {
        walk(id);
      }
    });
  };
  walk(folderId);
  return out;
}

// =====================================================================
// PE creds cache (server-side)
// =====================================================================

async function refreshPeCredsCache() {
  try {
    const resp = await fetch("/api/pe-creds", { credentials: "same-origin" });
    if (!resp.ok) return;
    const data = await resp.json();
    serverPeHosts = new Set(Array.isArray(data.peHosts) ? data.peHosts : []);
  } catch (_error) {
    /* offline or transient; leave cache untouched */
  }
}

async function clearAllPeCreds() {
  try {
    const resp = await fetch("/api/pe-creds", {
      method: "DELETE",
      credentials: "same-origin"
    });
    if (!resp.ok) {
      setStatus(`Could not clear PE credentials (HTTP ${resp.status}).`);
      return;
    }
    const data = await resp.json();
    serverPeHosts.clear();
    setStatus(
      data.cleared
        ? `Cleared cached PE credentials for ${data.cleared} host(s).`
        : "No cached PE credentials to clear."
    );
  } catch (error) {
    setStatus(`Failed to clear PE credentials: ${error.message}`);
  }
}

async function dropPeCreds(peHost) {
  serverPeHosts.delete(peHost);
  try {
    await fetch(`/api/pe-creds/${encodeURIComponent(peHost)}`, {
      method: "DELETE",
      credentials: "same-origin"
    });
  } catch (_error) {
    /* best-effort */
  }
}

function promptForPeCreds(peHost) {
  return new Promise((resolve) => {
    peCredsHostLabel.textContent = peHost;
    peCredsHostInput.value = peHost;
    peCredsUsernameInput.value = "admin";
    peCredsPasswordInput.value = "";
    peCredsErrorEl.style.display = "none";
    peCredsErrorEl.textContent = "";
    peCredsModal.classList.add("open");
    setTimeout(() => peCredsPasswordInput.focus(), 50);

    const cleanup = () => {
      peCredsModal.classList.remove("open");
      peCredsCancelBtn.removeEventListener("click", onCancel);
      peCredsSaveBtn.removeEventListener("click", onSave);
      peCredsPasswordInput.value = "";
    };
    const onCancel = () => {
      cleanup();
      resolve(false);
    };
    const onSave = async () => {
      const peUsername = peCredsUsernameInput.value.trim();
      const pePassword = peCredsPasswordInput.value;
      if (!peUsername || !pePassword) {
        peCredsErrorEl.textContent = "Username and password are required.";
        peCredsErrorEl.style.display = "block";
        return;
      }
      peCredsErrorEl.style.display = "none";
      peCredsSaveBtn.disabled = true;
      peCredsSaveBtn.textContent = "Testing...";
      try {
        const resp = await fetch("/api/pe-test", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            peHost,
            peUsername,
            pePassword,
            tlsSkipVerify: session.tlsSkipVerify
          })
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) {
          const baseMsg = data.error || `PE test failed (HTTP ${resp.status}).`;
          const detailMsg = data.details ? `\n\n${data.details}` : "";
          peCredsErrorEl.textContent = baseMsg + detailMsg;
          peCredsErrorEl.style.whiteSpace = "pre-wrap";
          peCredsErrorEl.style.fontFamily = "monospace";
          peCredsErrorEl.style.display = "block";
          return;
        }
        serverPeHosts.add(peHost);
        cleanup();
        resolve(true);
      } catch (error) {
        peCredsErrorEl.textContent = `Network error: ${error.message}`;
        peCredsErrorEl.style.display = "block";
      } finally {
        peCredsSaveBtn.disabled = false;
        peCredsSaveBtn.textContent = "Test & Save";
      }
    };
    peCredsCancelBtn.addEventListener("click", onCancel);
    peCredsSaveBtn.addEventListener("click", onSave);
  });
}

// =====================================================================
// VM list helpers
// =====================================================================

function getVmByUuid(uuid) {
  return vmCache.find((vm) => vm.uuid === uuid) || null;
}

// Different Prism API versions return the same logical state under
// different names (e.g. "POWERED_ON" vs "ON"). Collapse them to one
// canonical token for filtering and dropdown display.
function normalizePowerState(raw) {
  const s = String(raw || "").toUpperCase();
  if (s === "POWERED_ON" || s === "ON") return "ON";
  if (s === "POWERED_OFF" || s === "OFF") return "OFF";
  if (s === "SUSPENDED" || s === "PAUSED") return "PAUSED";
  return s || "UNKNOWN";
}

function applyFilters(vms) {
  const search = nameFilterInput.value.trim().toLowerCase();
  const power = powerStateFilter.value;
  return vms.filter((vm) => {
    const norm = normalizePowerState(vm.powerState);
    const haystack = [
      vm.name,
      vm.uuid,
      vm.ipAddress,
      norm,
      vm.isControllerVm ? "cvm ntnx controller" : "",
      vm.isFsvm ? "fsvm files" : "",
      vm.isHidden ? "hidden system" : ""
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const nameOk = !search || haystack.includes(search);
    const powerOk = !power || norm === power;
    return nameOk && powerOk;
  });
}

function fillFilterOptions() {
  const powerStates = Array.from(
    new Set(vmCache.map((vm) => normalizePowerState(vm.powerState)))
  ).sort();
  const prev = powerStateFilter.value;
  powerStateFilter.innerHTML = '<option value="">All power states</option>';
  powerStates.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    powerStateFilter.appendChild(option);
  });
  if (powerStates.includes(prev)) powerStateFilter.value = prev;
}

// =====================================================================
// Rendering
// =====================================================================

function metaLine(vm) {
  return [
    vm.isControllerVm ? "CVM" : null,
    vm.isFsvm ? "FSVM" : null,
    vm.isHidden ? "Hidden" : null,
    vm.consoleSupported === false ? "Console N/A" : null,
    vm.ipAddress || null
  ]
    .filter(Boolean)
    .join(" | ");
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function createVmRow(vm, opts = {}) {
  const row = document.createElement("div");
  row.className = "vm-row";
  row.dataset.vmUuid = vm.uuid;
  row.draggable = !!opts.draggable;
  const isLive = !!getVmByUuid(vm.uuid);
  const fav = isFavorite(vm.uuid);
  const normPower = normalizePowerState(vm.powerState);
  const pillLabel = vm.powerState ? normPower : isLive ? "UNKNOWN" : "Loading";
  row.innerHTML = `
    <button class="star ${fav ? "is-fav" : ""}" title="${fav ? "Remove favorite" : "Add favorite"}">${fav ? "★" : "☆"}</button>
    <div class="vm-item ${isLive ? "" : "is-loading"}">
      <div class="vm-name">${escapeHtml(vm.name || vm.uuid)}<span class="state-pill" data-state="${escapeHtml(normPower)}">${escapeHtml(pillLabel)}</span></div>
      <div class="vm-meta">${escapeHtml(metaLine(vm) || (isLive ? "" : "Updating from Prism Central..."))}</div>
    </div>
  `;
  const starBtn = row.querySelector(".star");
  const vmItem = row.querySelector(".vm-item");
  starBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (isFavorite(vm.uuid)) {
      removeFavorite(vm.uuid);
    } else {
      addFavorite(vm);
    }
    renderAll();
  });
  vmItem.addEventListener("click", () => {
    openConsoleFor(vm.uuid);
  });
  // Right-click → power on/off context menu
  vmItem.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    showVmContextMenu(event.clientX, event.clientY, vm.uuid);
  });
  if (opts.draggable) {
    row.addEventListener("dragstart", (event) => {
      event.stopPropagation();
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/x-nrcc-item", `vm:${vm.uuid}`);
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", (event) => {
      event.stopPropagation();
      row.classList.remove("dragging");
    });
  }
  return row;
}

function createFolderEl(folderId, depth) {
  const folder = favStore.folders[folderId];
  if (!folder) return null;
  const wrap = document.createElement("div");
  wrap.className = "fav-folder";
  wrap.dataset.folderId = folderId;
  wrap.draggable = true;
  if (isFolderCollapsed(folderId)) {
    wrap.classList.add("collapsed");
  }

  const header = document.createElement("div");
  header.className = "fav-folder-header";
  const initiallyCollapsed = isFolderCollapsed(folderId);
  header.innerHTML = `
    <button class="fav-folder-toggle" title="Expand / collapse">${initiallyCollapsed ? "▸" : "▾"}</button>
    <span class="fav-folder-name" spellcheck="false" title="Double-click to rename">${escapeHtml(folder.name)}</span>
    <button class="fav-folder-action launch" title="Open consoles for every VM in this folder" data-action="launch-all">▶</button>
    <button class="fav-folder-action" title="Add subfolder" data-action="add-sub">+</button>
    <button class="fav-folder-action danger" title="Delete folder" data-action="delete">×</button>
  `;
  wrap.appendChild(header);

  const children = document.createElement("div");
  children.className = "fav-folder-children";
  children.dataset.dropTarget = `folder:${folderId}`;
  wrap.appendChild(children);

  // Render children
  const ordering = favStore.ordering[folderId] || [];
  ordering.forEach((entry) => {
    const [type, id] = entry.split(":");
    if (type === "folder") {
      const child = createFolderEl(id, depth + 1);
      if (child) children.appendChild(child);
    } else if (type === "vm") {
      const vmSnap = getFavoriteVmSnapshot(id);
      children.appendChild(createVmRow(vmSnap, { draggable: true }));
    }
  });

  // Header interactions ------------------------------------------------
  const toggleBtn = header.querySelector(".fav-folder-toggle");
  const setCollapsed = (collapsed) => {
    wrap.classList.toggle("collapsed", collapsed);
    toggleBtn.textContent = collapsed ? "▸" : "▾";
    setFolderCollapsed(folderId, collapsed);
  };
  toggleBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    setCollapsed(!wrap.classList.contains("collapsed"));
  });

  // The name is rename-on-double-click. Keeping it non-editable by default
  // means single clicks (and drags) on the name don't conflict with HTML5
  // drag-and-drop on the folder wrap, which was the previous source of
  // "drag doesn't work" frustration.
  const nameEl = header.querySelector(".fav-folder-name");
  const startRename = () => {
    nameEl.setAttribute("contenteditable", "true");
    nameEl.focus();
    const range = document.createRange();
    range.selectNodeContents(nameEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };
  nameEl.addEventListener("dblclick", (event) => {
    event.stopPropagation();
    startRename();
  });
  nameEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      nameEl.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      nameEl.textContent = folder.name;
      nameEl.blur();
    }
  });
  nameEl.addEventListener("blur", () => {
    nameEl.removeAttribute("contenteditable");
    const next = nameEl.textContent.trim() || "Untitled";
    nameEl.textContent = next;
    if (next !== folder.name) {
      renameFolder(folderId, next);
    }
  });

  header.querySelector('[data-action="launch-all"]').addEventListener("click", (event) => {
    event.stopPropagation();
    launchAllInFolder(folderId);
  });
  header.querySelector('[data-action="add-sub"]').addEventListener("click", (event) => {
    event.stopPropagation();
    createFolder(folderId, "New folder");
    setCollapsed(false);
    renderFavoritesTree();
  });
  header.querySelector('[data-action="delete"]').addEventListener("click", (event) => {
    event.stopPropagation();
    const folderName = favStore.folders[folderId]?.name || "this folder";
    const childCount = (favStore.ordering[folderId] || []).length;
    const msg = childCount
      ? `Delete folder "${folderName}"? Its ${childCount} item(s) will move up to the parent.`
      : `Delete folder "${folderName}"?`;
    if (!confirm(msg)) return;
    deleteFolder(folderId);
    renderFavoritesTree();
  });

  // Drag source for the folder itself (whole wrap). stopPropagation
  // prevents this from firing again when this folder is nested inside
  // another draggable folder. If the user is currently editing the
  // folder name, abort so they can select text without starting a drag.
  wrap.addEventListener("dragstart", (event) => {
    if (document.activeElement === nameEl) {
      event.preventDefault();
      return;
    }
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/x-nrcc-item", `folder:${folderId}`);
    wrap.classList.add("dragging");
  });
  wrap.addEventListener("dragend", (event) => {
    event.stopPropagation();
    wrap.classList.remove("dragging");
  });

  // Folder header and children area are both drop targets (drops into the
  // folder). The destination container id MUST be the bare folder id --
  // that's how favStore.ordering is keyed -- not the prefixed entry form
  // ("folder:<id>") used in ordering arrays. attachDropTarget already
  // calls preventDefault/stopPropagation on drop so the favorites root
  // listener won't fire too.
  attachDropTarget(header, () => folderId, header, () => {
    // After a successful drop on the header, expand the folder so the
    // user can see what landed where.
    setCollapsed(false);
  });
  attachDropTarget(children, () => folderId, children);

  return wrap;
}

function attachDropTarget(el, getContainerId, highlightEl, onDrop) {
  el.addEventListener("dragenter", (event) => {
    if (!hasNrccItem(event)) return;
    event.preventDefault();
    if (highlightEl) highlightEl.classList.add("drag-over");
  });
  el.addEventListener("dragover", (event) => {
    if (!hasNrccItem(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (highlightEl) highlightEl.classList.add("drag-over");
  });
  el.addEventListener("dragleave", (event) => {
    // Avoid flicker when moving over child elements: only un-highlight when
    // the cursor truly leaves the highlighted element's bounding box.
    if (!highlightEl) return;
    const r = highlightEl.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    ) {
      highlightEl.classList.remove("drag-over");
    }
  });
  el.addEventListener("drop", (event) => {
    if (!hasNrccItem(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (highlightEl) highlightEl.classList.remove("drag-over");
    const item = event.dataTransfer.getData("text/x-nrcc-item");
    const dest = getContainerId();
    if (!item || !dest) return;
    const moved = moveItemTo(item, dest);
    if (moved && typeof onDrop === "function") onDrop();
    renderAll();
  });
}

function hasNrccItem(event) {
  return Array.from(event.dataTransfer.types || []).includes("text/x-nrcc-item");
}

function renderFavoritesTree() {
  favoritesTreeEl.innerHTML = "";
  const ordering = favStore.ordering.__root || [];
  if (!ordering.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No favorites yet. Star a VM to add it. Drag favorites into folders.";
    favoritesTreeEl.appendChild(empty);
    return;
  }
  ordering.forEach((entry) => {
    const [type, id] = entry.split(":");
    if (type === "folder") {
      const folderEl = createFolderEl(id, 0);
      if (folderEl) favoritesTreeEl.appendChild(folderEl);
    } else if (type === "vm") {
      const vmSnap = getFavoriteVmSnapshot(id);
      favoritesTreeEl.appendChild(createVmRow(vmSnap, { draggable: true }));
    }
  });
}

function renderVmList() {
  vmListEl.innerHTML = "";
  const filtered = applyFilters(vmCache);
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = isLoadingVms
      ? "Loading VMs from Prism Central..."
      : "No VMs to display.";
    vmListEl.appendChild(empty);
    return;
  }
  filtered.forEach((vm) => vmListEl.appendChild(createVmRow(vm, { draggable: true })));
}

function renderAll() {
  renderFavoritesTree();
  renderVmList();
}

// Root drop target for favorites. Use a custom highlight class so it
// doesn't visually compete with the per-folder drag-over treatment.
attachDropTarget(favoritesTreeEl, () => "__root", null);
favoritesTreeEl.addEventListener("dragenter", (event) => {
  if (hasNrccItem(event)) favoritesTreeEl.classList.add("drag-over-root");
});
favoritesTreeEl.addEventListener("dragover", (event) => {
  if (hasNrccItem(event)) favoritesTreeEl.classList.add("drag-over-root");
});
favoritesTreeEl.addEventListener("dragleave", (event) => {
  const r = favoritesTreeEl.getBoundingClientRect();
  if (
    event.clientX < r.left ||
    event.clientX > r.right ||
    event.clientY < r.top ||
    event.clientY > r.bottom
  ) {
    favoritesTreeEl.classList.remove("drag-over-root");
  }
});
favoritesTreeEl.addEventListener("drop", () => {
  favoritesTreeEl.classList.remove("drag-over-root");
});

// =====================================================================
// Authentication: login / logout
// =====================================================================

function showLoginScreen() {
  loginScreen.classList.remove("hidden");
  appShell.classList.add("locked");
  sessionInfo.classList.remove("visible");
}

function showApp() {
  loginScreen.classList.add("hidden");
  appShell.classList.remove("locked");
  sessionInfo.classList.add("visible");
}

async function login(event) {
  event.preventDefault();
  loginErrorEl.style.display = "none";
  const pcHost = loginPcHostInput.value.trim();
  const username = loginUsernameInput.value.trim();
  const password = loginPasswordInput.value;
  if (!pcHost || !username || !password) {
    loginErrorEl.textContent = "Prism Central IP, username, and password are required.";
    loginErrorEl.style.display = "block";
    return;
  }
  loginSubmitBtn.disabled = true;
  loginSubmitBtn.textContent = "Signing in...";
  try {
    const tlsSkipVerify = loginAllowTlsInput.checked;
    const includeHiddenVms = loginIncludeHiddenInput.checked;
    // Fast credential probe (~1-2 s) instead of the full VM list, so
    // the user gets into the app shell quickly. The actual VM list is
    // fetched in the background once the app is visible.
    const resp = await fetch("/api/pc-test", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pcHost, username, password, tlsSkipVerify })
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      const detailText = data.details ? ` ${data.details}` : "";
      throw new Error((data.error || `Login failed (HTTP ${resp.status}).`) + detailText);
    }

    // Success: store session credentials in memory and switch to app.
    session.pcHost = pcHost;
    session.username = username;
    session.password = password;
    session.tlsSkipVerify = tlsSkipVerify;
    session.includeHiddenVms = includeHiddenVms;
    session.loggedIn = true;
    persistProfileIfNeeded(pcHost, username);
    sessionUserLabel.textContent = `${username}@${pcHost}`;
    showApp();

    // Render favorites immediately so users see them before the live
    // VM list arrives.
    renderAll();

    // Kick off the VM list load in the background. Don't await -- the
    // app stays interactive while it streams in.
    refreshVmsInBackground();

    // Clear the password field so it doesn't linger in the DOM.
    loginPasswordInput.value = "";
  } catch (error) {
    loginErrorEl.textContent = error.message || "Sign in failed.";
    loginErrorEl.style.display = "block";
  } finally {
    loginSubmitBtn.disabled = false;
    loginSubmitBtn.textContent = "Sign in";
  }
}

function logout() {
  // Wipe credentials from memory.
  session.pcHost = "";
  session.username = "";
  session.password = "";
  session.loggedIn = false;
  // Close any open consoles.
  consoleSessions.slice().forEach((s) => closeSession(s.id));
  // Clear in-memory VM cache so the next login starts fresh.
  vmCache = [];
  isLoadingVms = false;
  renderAll();
  closeShowAll();
  hideContextMenu();
  updateConsoleControls();
  showLoginScreen();
  setStatus("Idle");
  setTimeout(() => loginPasswordInput.focus(), 100);
}

// =====================================================================
// VM loading
// =====================================================================

function applyVmListResult(data) {
  vmCache = Array.isArray(data.vms) ? data.vms : [];
  isLoadingVms = false;
  fillFilterOptions();
  refreshFavoriteSnapshots();
  renderAll();

  setStatus(
    `Loaded ${vmCache.length} VMs` +
      `${data.hiddenCount ? ` (${data.hiddenCount} hidden/system)` : ""}` +
      ` (${data.cvmCount || 0} CVM)` +
      ` (${data.fsvmCount || 0} FSVM)` +
      `${data.listVariant ? ` via ${data.listVariant}` : ""}.`
  );

  // CVM probe details still go to the browser console as a courtesy for
  // debugging, but are no longer surfaced in the page UI.
  if (Array.isArray(data.cvmProbeSummary) && data.cvmProbeSummary.length) {
    console.group("CVM probe details");
    data.cvmProbeSummary.forEach((p) => {
      const line = p.ok
        ? `OK  count=${p.count}  ${p.url}`
        : `ERR status=${p.status}  ${p.url}${p.message ? `\n      msg: ${p.message}` : ""}`;
      console.log(line);
    });
    console.groupEnd();
  }
}

async function refreshVmsInBackground() {
  if (!session.loggedIn) return;
  isLoadingVms = true;
  setStatus("Refreshing VM list...", { spinner: true });
  renderVmList();
  try {
    const resp = await fetch("/api/vms", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pcHost: session.pcHost,
        username: session.username,
        password: session.password,
        tlsSkipVerify: session.tlsSkipVerify,
        includeHiddenVms: session.includeHiddenVms
      })
    });
    const data = await resp.json();
    if (!resp.ok) {
      const detailText = data.details ? ` ${data.details}` : "";
      throw new Error((data.error || "Failed to refresh VMs.") + detailText);
    }
    applyVmListResult(data);
  } catch (error) {
    isLoadingVms = false;
    setStatus(`Error refreshing VMs: ${error.message}`);
    renderVmList();
  }
}

// =====================================================================
// Console sessions
// =====================================================================

function setActiveSession(sessionId) {
  activeSessionId = sessionId;
  consoleSessions.forEach((s) => {
    s.tabEl.classList.toggle("active", s.id === sessionId);
    s.screenEl.classList.toggle("active", s.id === sessionId);
  });
  updateConsoleControls();
}

function updateConsoleControls() {
  const has = consoleSessions.length > 0;
  consoleEmptyEl.style.display = has ? "none" : "grid";
  showAllBtn.disabled = !has;
  closeAllBtn.disabled = !has;
  // The Wall of Eyes popup is allowed to open with zero consoles -- it
  // just shows an empty-state and starts mirroring as soon as you open
  // some -- but it's also pointless from a cold start, so disable it.
  wallOfEyesBtn.disabled = !has;
  ctrlAltDelBtn.disabled = !has;
  pasteBtn.disabled = !has;
  consolePasteBtn.disabled = !has;
}

function sendCtrlAltDel() {
  const session = consoleSessions.find((s) => s.id === activeSessionId);
  if (!session?.rfb) return;
  const rfb = session.rfb;
  rfb.sendKey(0xffe3, "ControlLeft", true);
  rfb.sendKey(0xffe9, "AltLeft", true);
  rfb.sendKey(0xffff, "Delete", true);
  rfb.sendKey(0xffff, "Delete", false);
  rfb.sendKey(0xffe9, "AltLeft", false);
  rfb.sendKey(0xffe3, "ControlLeft", false);
  setStatus(`Sent Ctrl+Alt+Del to ${session.vmName}.`);
}

// Sentinel used so each in-flight paste cancels the previous one (clicking
// Paste twice in a row, switching tabs mid-paste, etc) instead of two
// typists fighting over the same console.
let activePasteToken = 0;

// Map a Unicode code point to the (keysym, dom-code) tuple expected by
// rfb.sendKey. Most characters fall through to keysymdef.lookup, which
// covers the entire X11 keysym space; we just special-case the keys that
// don't survive that round-trip cleanly (Tab, Enter, Backspace).
function keystrokeForCodePoint(cp) {
  if (cp === 0x09) return { keysym: 0xff09, code: "Tab" };
  if (cp === 0x0a || cp === 0x0d) return { keysym: 0xff0d, code: "Enter" };
  if (cp === 0x08) return { keysym: 0xff08, code: "Backspace" };
  const keysym = keysymdef.lookup(cp);
  if (!keysym) return null;
  // The 'code' hint is only consulted when the VNC server speaks the
  // QEMU extended key event extension; for plain RFB, the keysym alone
  // is what gets shipped, so a generic stand-in is fine for printables.
  let code = "";
  if (cp >= 0x30 && cp <= 0x39) code = `Digit${String.fromCodePoint(cp)}`;
  else if (cp >= 0x41 && cp <= 0x5a) code = `Key${String.fromCodePoint(cp)}`;
  else if (cp >= 0x61 && cp <= 0x7a) code = `Key${String.fromCodePoint(cp - 0x20)}`;
  else if (cp === 0x20) code = "Space";
  return { keysym, code };
}

// Type `text` into the active session by sending a synthetic key down/up
// for each code point. This bypasses the OS clipboard entirely, which is
// what we want — AHV guests have no clipboard-sync agent, so simply
// stuffing the VNC clipboard and pressing Ctrl+V (the previous behaviour)
// pasted whatever the guest had on its OS clipboard, not the host's.
async function typeTextIntoSession(session, text, opts = {}) {
  const { perCharDelayMs = 0, perLineDelayMs = 0 } = opts;
  const rfb = session?.rfb;
  if (!rfb) return;

  const myToken = ++activePasteToken;
  const normalized = text.replace(/\r\n?/g, "\n");

  // Best-effort: also seed the VNC server's clipboard so guests that
  // *do* have clipboard integration (rare on AHV, but not unheard of)
  // can use the host clipboard as well.
  try { rfb.clipboardPasteFrom(normalized); } catch (_e) { /* not fatal */ }

  // Iterate by code point so emoji and surrogate pairs are handled.
  const codePoints = Array.from(normalized);
  let typed = 0;
  let dropped = 0;

  for (const ch of codePoints) {
    if (myToken !== activePasteToken) return;
    if (session !== consoleSessions.find((s) => s.id === activeSessionId)) {
      setStatus(`Paste cancelled (active console changed).`);
      return;
    }
    const cp = ch.codePointAt(0);
    const stroke = keystrokeForCodePoint(cp);
    if (!stroke) { dropped++; continue; }
    rfb.sendKey(stroke.keysym, stroke.code, true);
    rfb.sendKey(stroke.keysym, stroke.code, false);
    typed++;

    const delay = (cp === 0x0a && perLineDelayMs) ? perLineDelayMs : perCharDelayMs;
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  }

  const droppedSuffix = dropped ? ` (${dropped} unsupported char${dropped === 1 ? "" : "s"} skipped)` : "";
  setStatus(`Typed ${typed} character${typed === 1 ? "" : "s"} into ${session.vmName}.${droppedSuffix}`);
}

async function readClipboardOrWarn() {
  if (!navigator.clipboard?.readText) {
    setStatus("Clipboard API unavailable — page must be served over HTTPS or localhost.");
    return null;
  }
  try {
    const text = await navigator.clipboard.readText();
    if (!text) { setStatus("Clipboard is empty."); return null; }
    return text;
  } catch (_err) {
    setStatus("Clipboard read failed — check browser permissions (allow clipboard access).");
    return null;
  }
}

async function pasteClipboardToConsole() {
  const session = consoleSessions.find((s) => s.id === activeSessionId);
  if (!session?.rfb) return;
  const text = await readClipboardOrWarn();
  if (text == null) return;
  setStatus(`Typing clipboard into ${session.vmName}...`, { spinner: true });
  await typeTextIntoSession(session, text);
}

async function consolePasteClipboard() {
  const session = consoleSessions.find((s) => s.id === activeSessionId);
  if (!session?.rfb) return;
  const text = await readClipboardOrWarn();
  if (text == null) return;
  setStatus(`Typing clipboard into ${session.vmName} (terminal-safe)...`, { spinner: true });
  // Linux PTYs (and especially some bash readline configs) drop bytes
  // when input arrives faster than the line discipline can buffer it,
  // so pace the keystrokes a touch and give the shell extra time to
  // finish executing each line before the next one starts.
  await typeTextIntoSession(session, text, { perCharDelayMs: 4, perLineDelayMs: 30 });
}

function closeAllSessions() {
  if (!consoleSessions.length) return;
  consoleSessions.slice().forEach((s) => closeSession(s.id));
  setStatus("Closed all console tabs.");
}

function closeSession(sessionId) {
  const idx = consoleSessions.findIndex((item) => item.id === sessionId);
  if (idx < 0) return;
  const s = consoleSessions[idx];
  try {
    s.rfb.disconnect();
  } catch (_error) {
    /* ignore disconnect issues */
  }
  s.tabEl.remove();
  s.screenEl.remove();
  consoleSessions.splice(idx, 1);
  if (activeSessionId === sessionId) {
    if (consoleSessions.length) {
      setActiveSession(consoleSessions[consoleSessions.length - 1].id);
    } else {
      activeSessionId = null;
    }
  }
  updateConsoleControls();
}

function createSessionTab(s) {
  const tab = document.createElement("div");
  tab.className = "tab";
  tab.innerHTML = `
    <span></span>
    <button class="tab-close" aria-label="Close tab">x</button>
  `;
  tab.querySelector("span").textContent = s.vmName;
  tab.addEventListener("click", () => setActiveSession(s.id));
  const closeBtn = tab.querySelector(".tab-close");
  closeBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    closeSession(s.id);
  });
  return tab;
}

async function openConsoleFor(vmUuid, opts = {}) {
  if (!session.loggedIn) return;
  const quiet = !!opts.quiet;
  // Inflight progress messages (one per VM) are suppressed in quiet mode
  // so a parallel "Launch All" doesn't have N consoles all stomping on
  // the global status bar with their own intermediate updates.
  const progress = quiet ? () => {} : (msg, o) => setStatus(msg, o);

  const existing = consoleSessions.find((s) => s.vmUuid === vmUuid);
  if (existing) {
    if (!quiet) {
      setActiveSession(existing.id);
      setStatus(`Switched to existing tab: ${existing.vmName}`);
    }
    return;
  }
  const liveVm = getVmByUuid(vmUuid);
  const snap = liveVm || favStore.vmMeta[vmUuid];
  if (!snap) {
    const msg = "VM details aren't loaded yet — please wait a moment for the VM list.";
    if (quiet) throw new Error(msg);
    setStatus(msg);
    return;
  }
  const tokenBody = {
    pcHost: session.pcHost,
    username: session.username,
    password: session.password,
    vmUuid,
    tlsSkipVerify: session.tlsSkipVerify,
    peHost: snap.peHost,
    cvmIp: snap.cvmIp || snap.ipAddress,
    cvmName: snap.cvmName || snap.name
  };

  if (snap.peHost) {
    if (!serverPeHosts.has(snap.peHost)) {
      // The Launch All caller does a single sequential pre-flight prompt
      // for each unique peHost and skips quiet calls whose creds aren't
      // already available, so this fall-through path is normally only
      // hit on a one-off click.
      if (quiet) {
        throw new Error(`PE credentials required for ${snap.peHost}.`);
      }
      setStatus(`Need PE credentials for ${snap.peHost}...`);
      const ok = await promptForPeCreds(snap.peHost);
      if (!ok) {
        setStatus("Cancelled. PE credentials are required for this CVM.");
        return;
      }
    }
    progress(`Requesting console token via PE ${snap.peHost}...`, { spinner: true });
  } else {
    progress(`Requesting console token for ${snap.name || vmUuid}...`, { spinner: true });
  }

  try {
    let resp = await fetch("/api/console-token", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tokenBody)
    });
    let data = await resp.json();

    if (!resp.ok && snap.peHost && (data?.needPeCredentials || resp.status === 401)) {
      await dropPeCreds(snap.peHost);
      if (quiet) {
        throw new Error(`PE credentials for ${snap.peHost} are no longer valid.`);
      }
      setStatus(`PE credentials needed for ${snap.peHost}.`);
      const ok = await promptForPeCreds(snap.peHost);
      if (!ok) {
        setStatus("Cancelled. PE credentials are required for this CVM.");
        return;
      }
      setStatus(`Retrying console token via PE ${snap.peHost}...`, { spinner: true });
      resp = await fetch("/api/console-token", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tokenBody)
      });
      data = await resp.json();
    }

    if (!resp.ok) {
      const detailText = data.details ? ` ${data.details}` : "";
      throw new Error((data.error || "Failed to get console token.") + detailText);
    }

    const wsUrl = data.websocketUrl;
    const vmName = (liveVm?.name) || snap.name || vmUuid;

    const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const screenEl = document.createElement("div");
    screenEl.className = "console-pane";
    screenStageEl.appendChild(screenEl);

    progress(`Connecting to ${vmName}...`, { spinner: true });
    const rfb = new RFB(screenEl, wsUrl, { credentials: {} });
    rfb.scaleViewport = true;
    rfb.resizeSession = true;
    rfb.background = "#000";

    rfb.addEventListener("connect", () => {
      // In quiet mode we don't spam the status bar with N "Connected:"
      // lines after a Launch All; the caller writes its own summary.
      if (!quiet) setStatus(`Connected: ${vmName}`);
    });
    rfb.addEventListener("disconnect", (event) =>
      // Disconnects are always reported -- the user needs to know.
      setStatus(`Disconnected ${vmName}. Clean: ${event.detail.clean}`)
    );
    rfb.addEventListener("securityfailure", (event) =>
      setStatus(`Security failure (${vmName}): ${event.detail.status}`)
    );

    const newSession = { id: sessionId, vmUuid, vmName, rfb, screenEl, tabEl: null };
    const tabEl = createSessionTab(newSession);
    newSession.tabEl = tabEl;
    consoleSessions.push(newSession);
    consoleTabsEl.appendChild(tabEl);
    // In quiet mode, only seed an active session if there isn't one
    // already; subsequent parallel opens just add tabs without stealing
    // focus from the first.
    if (!quiet || activeSessionId === null) {
      setActiveSession(sessionId);
    } else {
      updateConsoleControls();
    }
  } catch (error) {
    if (quiet) throw error;
    setStatus(`Error: ${error.message}`);
  }
}

// =====================================================================
// Right-click context menu (Power on / Power off)
// =====================================================================

function hideContextMenu() {
  ctxMenu.classList.remove("open");
  ctxMenu.innerHTML = "";
}

function showVmContextMenu(x, y, vmUuid) {
  const liveVm = getVmByUuid(vmUuid);
  const snap = liveVm || favStore.vmMeta[vmUuid];
  if (!snap) {
    hideContextMenu();
    return;
  }
  const isCvm = !!snap.peHost || !!snap.isControllerVm;
  const power = normalizePowerState(snap.powerState);
  const isOn = power === "ON";
  const isOff = power === "OFF";

  ctxMenu.innerHTML = "";
  const header = document.createElement("div");
  header.className = "ctx-menu-header";
  header.textContent = snap.name || vmUuid;
  ctxMenu.appendChild(header);

  const cvmDisabledTitle =
    "Power actions are disabled for CVMs — manage these from the cluster.";

  const onItem = document.createElement("div");
  onItem.className = "ctx-menu-item power-on";
  onItem.innerHTML = '<span class="ctx-icon">●</span><span>Power On</span>';
  if (isCvm) {
    onItem.classList.add("disabled");
    onItem.title = cvmDisabledTitle;
  } else if (isOn) {
    onItem.classList.add("disabled");
    onItem.title = "Already powered on.";
  } else {
    onItem.addEventListener("click", () => {
      hideContextMenu();
      requestVmPower(vmUuid, "on");
    });
  }
  ctxMenu.appendChild(onItem);

  const offItem = document.createElement("div");
  offItem.className = "ctx-menu-item power-off";
  offItem.innerHTML = '<span class="ctx-icon">■</span><span>Power Off</span>';
  if (isCvm) {
    offItem.classList.add("disabled");
    offItem.title = cvmDisabledTitle;
  } else if (isOff) {
    offItem.classList.add("disabled");
    offItem.title = "Already powered off.";
  } else {
    offItem.addEventListener("click", () => {
      hideContextMenu();
      const ok = confirm(
        `Force power off "${snap.name || vmUuid}"?\n\n` +
          `This is equivalent to pulling the plug — the guest OS will not be ` +
          `notified to shut down gracefully.`
      );
      if (ok) requestVmPower(vmUuid, "off");
    });
  }
  ctxMenu.appendChild(offItem);

  // Position, then clamp to viewport
  ctxMenu.style.left = `${x}px`;
  ctxMenu.style.top = `${y}px`;
  ctxMenu.classList.add("open");
  const rect = ctxMenu.getBoundingClientRect();
  if (rect.right > window.innerWidth - 4) {
    ctxMenu.style.left = `${Math.max(4, window.innerWidth - rect.width - 4)}px`;
  }
  if (rect.bottom > window.innerHeight - 4) {
    ctxMenu.style.top = `${Math.max(4, window.innerHeight - rect.height - 4)}px`;
  }
}

document.addEventListener("click", (event) => {
  if (!ctxMenu.contains(event.target)) hideContextMenu();
});
document.addEventListener("contextmenu", (event) => {
  // Hide any open menu before another opens (handlers below add a new one)
  if (!ctxMenu.contains(event.target)) hideContextMenu();
});
window.addEventListener("scroll", hideContextMenu, true);
window.addEventListener("blur", hideContextMenu);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hideContextMenu();
});

async function requestVmPower(vmUuid, action) {
  if (!session.loggedIn) return;
  const liveVm = getVmByUuid(vmUuid);
  const snap = liveVm || favStore.vmMeta[vmUuid];
  const vmName = snap?.name || vmUuid;
  setStatus(`Sending power-${action} to ${vmName}...`, { spinner: true });
  try {
    const resp = await fetch("/api/vm-power", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pcHost: session.pcHost,
        username: session.username,
        password: session.password,
        tlsSkipVerify: session.tlsSkipVerify,
        vmUuid,
        action,
        peHost: snap?.peHost || null
      })
    });
    const data = await resp.json();
    if (!resp.ok) {
      const detailText = data.details ? ` ${data.details}` : "";
      throw new Error((data.error || `Power-${action} failed.`) + detailText);
    }
    if (data.status === "succeeded") {
      setStatus(`Power-${action} succeeded for ${vmName}.`);
    } else if (data.status === "pending") {
      setStatus(`Power-${action} for ${vmName} is still pending on Prism Central.`);
    } else {
      setStatus(`Power-${action} submitted for ${vmName}.`);
    }
    // Refresh the VM list shortly so the power-state pill updates.
    setTimeout(() => {
      if (session.loggedIn) refreshVmsInBackground().catch(() => {});
    }, 1500);
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  }
}

// =====================================================================
// Show All grid overlay
// =====================================================================

function captureSessionThumbnail(s) {
  // noVNC renders its frames into a <canvas> inside the screen pane.
  const canvas = s.screenEl.querySelector("canvas");
  if (!canvas) return null;
  try {
    return canvas.toDataURL("image/png");
  } catch (_error) {
    // Tainted canvas (cross-origin frames) -> can't extract
    return null;
  }
}

function openShowAll() {
  if (!consoleSessions.length) return;
  consoleGridEl.innerHTML = "";

  const count = consoleSessions.length;
  const cols = Math.min(count, Math.ceil(Math.sqrt(count)));
  consoleGridEl.style.gridTemplateColumns = `repeat(${Math.max(cols, 1)}, minmax(0, 1fr))`;

  consoleSessions.forEach((s) => {
    const tile = document.createElement("div");
    tile.className = "console-grid-tile";

    const thumbWrap = document.createElement("div");
    thumbWrap.className = "console-grid-thumb";
    const dataUrl = captureSessionThumbnail(s);
    if (dataUrl) {
      const img = document.createElement("img");
      img.src = dataUrl;
      img.alt = s.vmName;
      thumbWrap.appendChild(img);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "thumb-empty";
      placeholder.textContent = "No frame yet";
      thumbWrap.appendChild(placeholder);
    }
    tile.appendChild(thumbWrap);

    const label = document.createElement("div");
    label.className = "console-grid-label";
    label.textContent = s.vmName;
    tile.appendChild(label);

    tile.addEventListener("click", (event) => {
      event.stopPropagation();
      setActiveSession(s.id);
      closeShowAll();
    });
    consoleGridEl.appendChild(tile);
  });

  consoleGridOverlay.classList.add("open");
}

function closeShowAll() {
  consoleGridOverlay.classList.remove("open");
}

consoleGridOverlay.addEventListener("click", (event) => {
  // Click on the backdrop (not on a tile) closes the overlay
  if (event.target === consoleGridOverlay) closeShowAll();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && consoleGridOverlay.classList.contains("open")) {
    closeShowAll();
  }
});

// =====================================================================
// Wall of Eyes (multi-console popup mirror)
// =====================================================================

function openWallOfEyes() {
  // If a wall window is already open, just bring it forward instead of
  // spawning a second one.
  if (wallOfEyesWindow && !wallOfEyesWindow.closed) {
    try {
      wallOfEyesWindow.focus();
      return;
    } catch (_e) {
      // fall through and reopen
    }
  }

  const features = [
    "popup=yes",
    "noopener=no",
    "width=1280",
    "height=800",
    "menubar=no",
    "toolbar=no",
    "location=no",
    "status=no"
  ].join(",");

  const win = window.open("/wall.html", "nrcc-wall-of-eyes", features);
  if (!win) {
    setStatus(
      "Couldn't open Wall of Eyes window — your browser may have blocked the popup."
    );
    return;
  }
  wallOfEyesWindow = win;
  setStatus(`Opened Wall of Eyes (${consoleSessions.length} console(s)).`);
  // Best-effort: clear our reference once the popup is closed so a
  // subsequent click reopens it.
  const watch = setInterval(() => {
    if (win.closed) {
      clearInterval(watch);
      if (wallOfEyesWindow === win) wallOfEyesWindow = null;
    }
  }, 1500);
}

// Close the Wall of Eyes popup automatically when the parent navigates
// away or logs out, so a stale popup doesn't sit there mirroring nothing.
window.addEventListener("beforeunload", () => {
  if (wallOfEyesWindow && !wallOfEyesWindow.closed) {
    try {
      wallOfEyesWindow.close();
    } catch (_e) {
      /* ignore */
    }
  }
});

// =====================================================================
// Launch All (open consoles for every VM in a folder, recursively)
// =====================================================================

async function launchAllInFolder(folderId) {
  if (!session.loggedIn) return;
  const folder = favStore.folders[folderId];
  const folderName = folder?.name || "folder";
  const uuids = collectVmUuidsInFolder(folderId);
  if (!uuids.length) {
    setStatus(`Folder "${folderName}" is empty.`);
    return;
  }

  // Filter out VMs whose tabs are already open or whose metadata isn't
  // available yet (e.g. a favorite that no longer exists in PC).
  const toOpen = [];
  let alreadyOpen = 0;
  let skippedNoMeta = 0;
  for (const uuid of uuids) {
    if (consoleSessions.some((s) => s.vmUuid === uuid)) {
      alreadyOpen += 1;
      continue;
    }
    const snap = getVmByUuid(uuid) || favStore.vmMeta[uuid];
    if (!snap) {
      skippedNoMeta += 1;
      continue;
    }
    toOpen.push({ uuid, snap });
  }

  if (!toOpen.length) {
    setStatus(
      `"${folderName}": nothing to open (` +
        `${alreadyOpen} already open` +
        (skippedNoMeta ? `, ${skippedNoMeta} not in current VM list` : "") +
        ")."
    );
    return;
  }

  // Pre-flight: collect every unique PE host we'll need credentials for
  // and prompt once each, sequentially. Doing this up-front means the
  // parallel batch below never opens N modals at once for the same PE,
  // and any PE the user cancels just causes those VMs to be skipped.
  const peHostsNeeded = new Set();
  for (const { snap } of toOpen) {
    if (snap.peHost && !serverPeHosts.has(snap.peHost)) {
      peHostsNeeded.add(snap.peHost);
    }
  }
  const cancelledPeHosts = new Set();
  for (const peHost of peHostsNeeded) {
    setStatus(`Need PE credentials for ${peHost}...`);
    // eslint-disable-next-line no-await-in-loop
    const ok = await promptForPeCreds(peHost);
    if (!ok) cancelledPeHosts.add(peHost);
  }

  // Drop any VMs whose PE the user just declined to authenticate.
  const launchable = toOpen.filter(
    ({ snap }) => !snap.peHost || !cancelledPeHosts.has(snap.peHost)
  );
  const cancelledVms = toOpen.length - launchable.length;

  setStatus(
    `Launching ${launchable.length} console(s) from "${folderName}"...`,
    { spinner: true }
  );

  // Open every console in parallel. openConsoleFor in quiet mode keeps
  // the global status bar clean and surfaces errors via thrown
  // exceptions for us to count below.
  const results = await Promise.all(
    launchable.map(async ({ uuid }) => {
      try {
        await openConsoleFor(uuid, { quiet: true });
        return { uuid, opened: true };
      } catch (error) {
        return { uuid, error: error.message || String(error) };
      }
    })
  );

  const opened = results.filter((r) => r.opened).length;
  const failed = results.length - opened;
  if (failed) {
    const firstFailure = results.find((r) => r.error)?.error || "";
    console.warn(
      `[launch-all] ${failed} VM(s) failed in "${folderName}":`,
      results.filter((r) => r.error)
    );
    setStatus(
      `"${folderName}": opened ${opened} of ${launchable.length}` +
        (alreadyOpen ? `, ${alreadyOpen} already open` : "") +
        (cancelledVms ? `, ${cancelledVms} skipped (PE cancelled)` : "") +
        `. ${failed} failed: ${firstFailure}`
    );
  } else {
    setStatus(
      `"${folderName}": opened ${opened} console(s)` +
        (alreadyOpen ? `, ${alreadyOpen} already open` : "") +
        (cancelledVms ? `, ${cancelledVms} skipped (PE cancelled)` : "") +
        "."
    );
  }
}

// =====================================================================
// Wiring
// =====================================================================

loginForm.addEventListener("submit", login);
logoutBtn.addEventListener("click", logout);
forgetPeCredsBtn.addEventListener("click", clearAllPeCreds);

addFavFolderBtn.addEventListener("click", () => {
  createFolder("__root", "New folder");
  renderFavoritesTree();
});

nameFilterInput.addEventListener("input", renderVmList);
powerStateFilter.addEventListener("change", renderVmList);

showAllBtn.addEventListener("click", openShowAll);
wallOfEyesBtn.addEventListener("click", openWallOfEyes);
ctrlAltDelBtn.addEventListener("click", sendCtrlAltDel);
pasteBtn.addEventListener("click", pasteClipboardToConsole);
consolePasteBtn.addEventListener("click", consolePasteClipboard);
closeAllBtn.addEventListener("click", () => {
  if (!consoleSessions.length) return;
  const ok = confirm(
    `Close all ${consoleSessions.length} open console tab(s)?`
  );
  if (ok) closeAllSessions();
});

// =====================================================================
// Boot
// =====================================================================

loadSavedProfile();
loadFavoritesStore();
renderAll();
refreshPeCredsCache();
showLoginScreen();
setTimeout(() => {
  if (loginPcHostInput.value && loginUsernameInput.value) {
    loginPasswordInput.focus();
  } else {
    loginPcHostInput.focus();
  }
}, 100);
