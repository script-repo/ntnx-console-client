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
const pasteKeymapSelect = document.getElementById("pasteKeymap");
const screenshotBtn = document.getElementById("screenshotBtn");
const screenshotBrowseBtn = document.getElementById("screenshotBrowseBtn");
const screenshotBrowseModal = document.getElementById("screenshotBrowseModal");
const screenshotBrowseGrid = document.getElementById("screenshotBrowseGrid");
const screenshotBrowseEmpty = document.getElementById("screenshotBrowseEmpty");
const screenshotBrowseTitle = document.getElementById("screenshotBrowseTitle");
const screenshotBrowseCount = document.getElementById("screenshotBrowseCount");
const screenshotBrowseRefresh = document.getElementById("screenshotBrowseRefresh");
const screenshotBrowseCloseBtn = document.getElementById("screenshotBrowseClose");

const chatRoot = document.getElementById("chatRoot");
const chatLauncher = document.getElementById("chatLauncher");
const chatLauncherBadge = document.getElementById("chatLauncherBadge");
const chatPanel = document.getElementById("chatPanel");
const chatPanelTitle = document.getElementById("chatPanelTitle");
const chatPanelSubtitle = document.getElementById("chatPanelSubtitle");
const chatPanelClose = document.getElementById("chatPanelClose");
const chatPresenceEl = document.getElementById("chatPanelPresence");
const chatMessagesEl = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");
const chatStatusEl = document.getElementById("chatStatus");
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
    // Mirror the PC username into appConfig so the chat UI can label
    // own messages without having to wait for the WS hello.
    appConfig.currentUser = username;
    showApp();

    // Render favorites immediately so users see them before the live
    // VM list arrives.
    renderAll();

    // Kick off the VM list load in the background. Don't await -- the
    // app stays interactive while it streams in.
    refreshVmsInBackground();

    // Multi-user only: open the chat WebSocket so presence is live the
    // moment the user lands in the app shell.
    if (appConfig.multiUser) openChatSocket();

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
  // Tell the server to clear the cached identity / PE creds for this
  // session cookie. Fire-and-forget; the client-side logout proceeds
  // even if the server is unreachable.
  try {
    fetch("/api/logout", { method: "POST", credentials: "same-origin" })
      .catch(() => { /* ignore network errors during logout */ });
  } catch (_e) { /* ignore */ }
  // Multi-user only: tear down the chat socket and forget chat state.
  if (typeof teardownChat === "function") teardownChat();
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
  // Multi-user only: switch the chat panel to follow the active VM.
  if (typeof onActiveSessionChangedForChat === "function") {
    onActiveSessionChangedForChat();
  }
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
  pasteKeymapSelect.disabled = !has;
  screenshotBtn.disabled = !has;
  screenshotBrowseBtn.disabled = !has;
  // Sync the keymap select to whatever the active tab is using, so
  // users can see at a glance which layout will be applied if they
  // hit Paste right now.
  const active = consoleSessions.find((s) => s.id === activeSessionId);
  if (active) {
    pasteKeymapSelect.value = active.keymap || lastUsedKeymap || DEFAULT_KEYMAP_ID;
  } else {
    pasteKeymapSelect.value = lastUsedKeymap || DEFAULT_KEYMAP_ID;
  }
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

// =====================================================================
// Guest keyboard layouts for Paste
// =====================================================================
//
// The Paste action types each clipboard character into the guest VM as
// a synthesized keystroke. AHV's QEMU uses the QEMU extended-key-event
// (scancode) path, so the scancode + modifier travels untranslated and
// is interpreted by the *guest* OS keyboard layout. That means we have
// to know which physical key (DOM code, e.g. "Digit7") and which
// modifiers (Shift / AltGr) produce a given character on the layout
// the guest is configured for.
//
// Each entry in *_DATA below is `[unshifted, shifted, altgr, code]`,
// where `altgr` is null if no AltGr-modified character is reachable
// from that key. `buildLayout` flattens the table into a Map keyed by
// character, so the typing engine can do an O(1) lookup per code point.
//
// Sources cross-checked: QEMU pc-bios/keymaps/*, X11 xkb-data
// (/usr/share/X11/xkb/symbols/*), and the Wikipedia keyboard-layout
// reference images for each locale. Letters / digits that share both
// a position and a shifted character with US-QWERTY are added by the
// helper `addUsBaseLetters` / `addUsBaseDigits` so each table only has
// to list the differences.

// X11 keysyms we need beyond the printable Latin-1 range that
// keysymdef.lookup already returns directly.
const XK_BACKSPACE  = 0xff08;
const XK_TAB        = 0xff09;
const XK_RETURN     = 0xff0d;
const XK_SHIFT_L    = 0xffe1;
const XK_ISO_LEVEL3 = 0xfe03; // AltGr (right Alt as Mode_switch / Level3)

function addUsBaseLetters(rows) {
  for (let i = 0; i < 26; i++) {
    const lower = String.fromCharCode(0x61 + i);
    const upper = String.fromCharCode(0x41 + i);
    rows.push([lower, upper, null, `Key${upper}`]);
  }
}

function addUsBaseDigits(rows) {
  const unshifted = "1234567890";
  const shifted   = "!@#$%^&*()";
  for (let i = 0; i < 10; i++) {
    rows.push([unshifted[i], shifted[i], null, `Digit${unshifted[i]}`]);
  }
}

// US QWERTY (en-us): the AHV default and what almost every enterprise
// VM ships with. Pure Latin-1 + ASCII punctuation; no AltGr layer.
const US_DATA = (() => {
  const rows = [];
  addUsBaseLetters(rows);
  addUsBaseDigits(rows);
  rows.push(
    ["`",  "~",  null, "Backquote"],
    ["-",  "_",  null, "Minus"],
    ["=",  "+",  null, "Equal"],
    ["[",  "{",  null, "BracketLeft"],
    ["]",  "}",  null, "BracketRight"],
    ["\\", "|",  null, "Backslash"],
    [";",  ":",  null, "Semicolon"],
    ["'",  "\"", null, "Quote"],
    [",",  "<",  null, "Comma"],
    [".",  ">",  null, "Period"],
    ["/",  "?",  null, "Slash"],
    [" ",  null, null, "Space"]
  );
  return rows;
})();

// UK QWERTY (en-gb): same letters/digits as US, but `2` is doublequote
// (not @), `3` is `£` (not #), Backquote is `` ` / ¬ ``, Quote is `' / @`,
// Backslash is `# / ~`, IntlBackslash carries `\ / |`. AltGr+4 = €.
const UK_DATA = (() => {
  const rows = [];
  addUsBaseLetters(rows);
  // Digit row diffs from US
  rows.push(
    ["1", "!", null, "Digit1"],
    ["2", "\"", null, "Digit2"],
    ["3", "£", null, "Digit3"],
    ["4", "$", "€",  "Digit4"],
    ["5", "%", null, "Digit5"],
    ["6", "^", null, "Digit6"],
    ["7", "&", null, "Digit7"],
    ["8", "*", null, "Digit8"],
    ["9", "(", null, "Digit9"],
    ["0", ")", null, "Digit0"]
  );
  rows.push(
    ["`",  "¬",  null, "Backquote"],
    ["-",  "_",  null, "Minus"],
    ["=",  "+",  null, "Equal"],
    ["[",  "{",  null, "BracketLeft"],
    ["]",  "}",  null, "BracketRight"],
    ["#",  "~",  null, "Backslash"],
    [";",  ":",  null, "Semicolon"],
    ["'",  "@",  null, "Quote"],
    [",",  "<",  null, "Comma"],
    [".",  ">",  null, "Period"],
    ["/",  "?",  null, "Slash"],
    ["\\", "|",  null, "IntlBackslash"],
    [" ",  null, null, "Space"]
  );
  return rows;
})();

// French AZERTY (fr-FR). Top row digits are SHIFTED; unshifted row is
// `& é " ' ( - è _ ç à`. AltGr layer carries `~ # { [ | \` ^ @ ] }` on
// the digit row, plus `€` on E and `¤` on $.
const FR_DATA = [
  // Letter row 1 (AZERTY): A and Q swap, Z and W swap (vs US-QWERTY)
  ["a", "A", null, "KeyQ"],
  ["z", "Z", null, "KeyW"],
  ["e", "E", "€",  "KeyE"],
  ["r", "R", null, "KeyR"],
  ["t", "T", null, "KeyT"],
  ["y", "Y", null, "KeyY"],
  ["u", "U", null, "KeyU"],
  ["i", "I", null, "KeyI"],
  ["o", "O", null, "KeyO"],
  ["p", "P", null, "KeyP"],
  // Letter row 2
  ["q", "Q", null, "KeyA"],
  ["s", "S", null, "KeyS"],
  ["d", "D", null, "KeyD"],
  ["f", "F", null, "KeyF"],
  ["g", "G", null, "KeyG"],
  ["h", "H", null, "KeyH"],
  ["j", "J", null, "KeyJ"],
  ["k", "K", null, "KeyK"],
  ["l", "L", null, "KeyL"],
  ["m", "M", null, "Semicolon"],
  // Letter row 3 (Z and W swap)
  ["w", "W", null, "KeyZ"],
  ["x", "X", null, "KeyX"],
  ["c", "C", null, "KeyC"],
  ["v", "V", null, "KeyV"],
  ["b", "B", null, "KeyB"],
  ["n", "N", null, "KeyN"],
  // Top number row (unshifted = letters with diacritics)
  ["&", "1", null, "Digit1"],
  ["é", "2", "~",  "Digit2"],
  ["\"", "3", "#", "Digit3"],
  ["'", "4", "{",  "Digit4"],
  ["(", "5", "[",  "Digit5"],
  ["-", "6", "|",  "Digit6"],
  ["è", "7", "`",  "Digit7"],
  ["_", "8", "\\", "Digit8"],
  ["ç", "9", "^",  "Digit9"],
  ["à", "0", "@",  "Digit0"],
  [")", "°", "]",  "Minus"],
  ["=", "+", "}",  "Equal"],
  // Punctuation
  ["$", "£", "¤",  "BracketRight"],
  ["*", "µ", null, "Backslash"],
  ["ù", "%", null, "Quote"],
  [",", "?", null, "KeyM"],
  [";", ".", null, "Comma"],
  [":", "/", null, "Period"],
  ["!", "§", null, "Slash"],
  ["²", null, null, "Backquote"],
  ["<", ">", null, "IntlBackslash"],
  [" ", null, null, "Space"]
];

// German QWERTZ (de-DE). Y and Z swap. AltGr carries `@ \ | { [ ] } ~ €`
// on the top row; `µ` on M; superscripts on 2/3.
const DE_DATA = (() => {
  const rows = [];
  // Letters: US base, but Y and Z are swapped
  for (let i = 0; i < 26; i++) {
    const lower = String.fromCharCode(0x61 + i);
    const upper = String.fromCharCode(0x41 + i);
    let code = `Key${upper}`;
    if (upper === "Y") code = "KeyZ";
    else if (upper === "Z") code = "KeyY";
    rows.push([lower, upper, null, code]);
  }
  // E gets €, M gets µ via AltGr
  for (const r of rows) {
    if (r[0] === "e") r[2] = "€";
    if (r[0] === "m") r[2] = "µ";
    if (r[0] === "q") r[2] = "@";
  }
  rows.push(
    ["1", "!", null, "Digit1"],
    ["2", "\"", "²", "Digit2"],
    ["3", "§", "³", "Digit3"],
    ["4", "$", null, "Digit4"],
    ["5", "%", null, "Digit5"],
    ["6", "&", null, "Digit6"],
    ["7", "/", "{",  "Digit7"],
    ["8", "(", "[",  "Digit8"],
    ["9", ")", "]",  "Digit9"],
    ["0", "=", "}",  "Digit0"],
    ["ß", "?", "\\", "Minus"],
    ["´", "`", null, "Equal"],
    ["ü", "Ü", null, "BracketLeft"],
    ["+", "*", "~",  "BracketRight"],
    ["ö", "Ö", null, "Semicolon"],
    ["ä", "Ä", null, "Quote"],
    ["#", "'", null, "Backslash"],
    [",", ";", null, "Comma"],
    [".", ":", null, "Period"],
    ["-", "_", null, "Slash"],
    ["^", "°", null, "Backquote"],
    ["<", ">", "|",  "IntlBackslash"],
    [" ", null, null, "Space"]
  );
  return rows;
})();

// Spanish (es-ES). QWERTY-base with `Ñ`, `¿/¡`, AltGr carries
// `| @ # ¬ € ¬ \ ` on the symbol row, plus `[ ] { }` on the bracket row.
const ES_DATA = (() => {
  const rows = [];
  addUsBaseLetters(rows);
  // E, +2 = €, +Q = nothing standard; AltGr+letter additions:
  for (const r of rows) {
    if (r[0] === "e") r[2] = "€";
  }
  rows.push(
    ["1", "!", "|",  "Digit1"],
    ["2", "\"", "@", "Digit2"],
    ["3", "·", "#",  "Digit3"],
    ["4", "$", "~",  "Digit4"],
    ["5", "%", null, "Digit5"],
    ["6", "&", "¬",  "Digit6"],
    ["7", "/", null, "Digit7"],
    ["8", "(", null, "Digit8"],
    ["9", ")", null, "Digit9"],
    ["0", "=", null, "Digit0"],
    ["'", "?", null, "Minus"],
    ["¡", "¿", null, "Equal"],
    ["`", "^", "[",  "BracketLeft"],
    ["+", "*", "]",  "BracketRight"],
    ["ñ", "Ñ", null, "Semicolon"],
    ["´", "¨", "{",  "Quote"],
    ["ç", "Ç", "}",  "Backslash"],
    [",", ";", null, "Comma"],
    [".", ":", null, "Period"],
    ["-", "_", null, "Slash"],
    ["º", "ª", "\\", "Backquote"],
    ["<", ">", null, "IntlBackslash"],
    [" ", null, null, "Space"]
  );
  return rows;
})();

// Italian (it-IT). Similar to Spanish in structure but different
// accented vowels and with `@` on Quote (AltGr+ò) and `#` on AltGr+à.
const IT_DATA = (() => {
  const rows = [];
  addUsBaseLetters(rows);
  for (const r of rows) {
    if (r[0] === "e") r[2] = "€";
  }
  rows.push(
    ["1", "!", null, "Digit1"],
    ["2", "\"", null, "Digit2"],
    ["3", "£", null, "Digit3"],
    ["4", "$", null, "Digit4"],
    ["5", "%", null, "Digit5"],
    ["6", "&", null, "Digit6"],
    ["7", "/", null, "Digit7"],
    ["8", "(", null, "Digit8"],
    ["9", ")", null, "Digit9"],
    ["0", "=", null, "Digit0"],
    ["'", "?", null, "Minus"],
    ["ì", "^", null, "Equal"],
    ["è", "é", "[",  "BracketLeft"],
    ["+", "*", "]",  "BracketRight"],
    ["ò", "ç", "@",  "Semicolon"],
    ["à", "°", "#",  "Quote"],
    ["ù", "§", null, "Backslash"],
    [",", ";", null, "Comma"],
    [".", ":", null, "Period"],
    ["-", "_", null, "Slash"],
    ["\\", "|", null, "Backquote"],
    ["<", ">", null, "IntlBackslash"],
    [" ", null, null, "Space"]
  );
  return rows;
})();

// Brazilian ABNT2 (pt-BR). QWERTY-base with cedilla on Quote, accented
// chars via dead keys (we don't synthesize dead-key sequences — those
// characters fall through to the raw-keysym path).
const BR_DATA = (() => {
  const rows = [];
  addUsBaseLetters(rows);
  for (const r of rows) {
    if (r[0] === "e") r[2] = "€";
  }
  rows.push(
    ["1", "!", null, "Digit1"],
    ["2", "@", null, "Digit2"],
    ["3", "#", null, "Digit3"],
    ["4", "$", null, "Digit4"],
    ["5", "%", "¢",  "Digit5"],
    ["6", "¨", null, "Digit6"],
    ["7", "&", null, "Digit7"],
    ["8", "*", null, "Digit8"],
    ["9", "(", null, "Digit9"],
    ["0", ")", null, "Digit0"],
    ["-", "_", null, "Minus"],
    ["=", "+", "§",  "Equal"],
    ["'", "`", null, "BracketLeft"],
    ["[", "{", "ª",  "BracketRight"],
    ["ç", "Ç", null, "Semicolon"],
    ["~", "^", null, "Quote"],
    ["]", "}", "º",  "Backslash"],
    [",", "<", null, "Comma"],
    [".", ">", null, "Period"],
    [";", ":", null, "Slash"],
    ["/", "?", "°",  "IntlBackslash"],
    ["\\", "|", null, "Backquote"],
    [" ", null, null, "Space"]
  );
  return rows;
})();

// Swedish / Finnish (sv-SE / fi-FI). QWERTY-base with å, ä, ö on the
// right side, € on AltGr+E, @ on AltGr+2, $ on AltGr+4. Norwegian and
// Danish are very close but swap Ø/Å — a separate option later if anyone
// needs them.
const NORDIC_DATA = (() => {
  const rows = [];
  addUsBaseLetters(rows);
  for (const r of rows) {
    if (r[0] === "e") r[2] = "€";
  }
  rows.push(
    ["1", "!", null, "Digit1"],
    ["2", "\"", "@", "Digit2"],
    ["3", "#", "£",  "Digit3"],
    ["4", "¤", "$",  "Digit4"],
    ["5", "%", "€",  "Digit5"],
    ["6", "&", null, "Digit6"],
    ["7", "/", "{",  "Digit7"],
    ["8", "(", "[",  "Digit8"],
    ["9", ")", "]",  "Digit9"],
    ["0", "=", "}",  "Digit0"],
    ["+", "?", "\\", "Minus"],
    ["´", "`", null, "Equal"],
    ["å", "Å", null, "BracketLeft"],
    ["¨", "^", "~",  "BracketRight"],
    ["ö", "Ö", null, "Semicolon"],
    ["ä", "Ä", null, "Quote"],
    ["'", "*", null, "Backslash"],
    [",", ";", null, "Comma"],
    [".", ":", null, "Period"],
    ["-", "_", null, "Slash"],
    ["§", "½", null, "Backquote"],
    ["<", ">", "|",  "IntlBackslash"],
    [" ", null, null, "Space"]
  );
  return rows;
})();

// US Dvorak (dvorak). Same physical keyboard, completely remapped
// letter/punctuation positions. Top number row matches US-QWERTY.
const DVORAK_DATA = (() => {
  // Map: char -> US physical-key code
  const layout = {
    // Top letter row
    "'": "KeyQ", "\"": "KeyQ",
    ",": "KeyW", "<": "KeyW",
    ".": "KeyE", ">": "KeyE",
    "p": "KeyR", "P": "KeyR",
    "y": "KeyT", "Y": "KeyT",
    "f": "KeyY", "F": "KeyY",
    "g": "KeyU", "G": "KeyU",
    "c": "KeyI", "C": "KeyI",
    "r": "KeyO", "R": "KeyO",
    "l": "KeyP", "L": "KeyP",
    "/": "BracketLeft", "?": "BracketLeft",
    "=": "BracketRight", "+": "BracketRight",
    // Home row
    "a": "KeyA", "A": "KeyA",
    "o": "KeyS", "O": "KeyS",
    "e": "KeyD", "E": "KeyD",
    "u": "KeyF", "U": "KeyF",
    "i": "KeyG", "I": "KeyG",
    "d": "KeyH", "D": "KeyH",
    "h": "KeyJ", "H": "KeyJ",
    "t": "KeyK", "T": "KeyK",
    "n": "KeyL", "N": "KeyL",
    "s": "Semicolon", "S": "Semicolon",
    "-": "Quote", "_": "Quote",
    // Bottom row
    ";": "KeyZ", ":": "KeyZ",
    "q": "KeyX", "Q": "KeyX",
    "j": "KeyC", "J": "KeyC",
    "k": "KeyV", "K": "KeyV",
    "x": "KeyB", "X": "KeyB",
    "b": "KeyN", "B": "KeyN",
    "m": "KeyM", "M": "KeyM",
    "w": "Comma", "W": "Comma",
    "v": "Period", "V": "Period",
    "z": "Slash", "Z": "Slash"
  };
  const isShifted = (ch) => /^[A-Z?<>+_:"]$/.test(ch) || ch === "\"";
  const rows = [];
  // Group same code together as [unshifted, shifted]
  const groups = new Map();
  for (const [ch, code] of Object.entries(layout)) {
    if (!groups.has(code)) groups.set(code, [null, null]);
    const slot = groups.get(code);
    if (isShifted(ch)) slot[1] = ch;
    else slot[0] = ch;
  }
  for (const [code, [u, s]] of groups) {
    rows.push([u, s, null, code]);
  }
  // Digits + symbol keys keep US-QWERTY positions
  addUsBaseDigits(rows);
  rows.push(
    ["`",  "~",  null, "Backquote"],
    ["\\", "|",  null, "Backslash"],
    [" ",  null, null, "Space"]
  );
  return rows;
})();

// US Colemak (colemak). Same physical keyboard, ergonomic remap that
// keeps QWERTY positions for Z X C V B and most punctuation.
const COLEMAK_DATA = (() => {
  const layout = {
    "q": "KeyQ", "Q": "KeyQ",
    "w": "KeyW", "W": "KeyW",
    "f": "KeyE", "F": "KeyE",
    "p": "KeyR", "P": "KeyR",
    "g": "KeyT", "G": "KeyT",
    "j": "KeyY", "J": "KeyY",
    "l": "KeyU", "L": "KeyU",
    "u": "KeyI", "U": "KeyI",
    "y": "KeyO", "Y": "KeyO",
    ";": "KeyP", ":": "KeyP",
    // Home row
    "a": "KeyA", "A": "KeyA",
    "r": "KeyS", "R": "KeyS",
    "s": "KeyD", "S": "KeyD",
    "t": "KeyF", "T": "KeyF",
    "d": "KeyG", "D": "KeyG",
    "h": "KeyH", "H": "KeyH",
    "n": "KeyJ", "N": "KeyJ",
    "e": "KeyK", "E": "KeyK",
    "i": "KeyL", "I": "KeyL",
    "o": "Semicolon", "O": "Semicolon",
    // Bottom row (same as QWERTY for Z X C V B M , . /)
    "z": "KeyZ", "Z": "KeyZ",
    "x": "KeyX", "X": "KeyX",
    "c": "KeyC", "C": "KeyC",
    "v": "KeyV", "V": "KeyV",
    "b": "KeyB", "B": "KeyB",
    "k": "KeyN", "K": "KeyN",
    "m": "KeyM", "M": "KeyM"
  };
  const isShifted = (ch) => /^[A-Z:]$/.test(ch);
  const rows = [];
  const groups = new Map();
  for (const [ch, code] of Object.entries(layout)) {
    if (!groups.has(code)) groups.set(code, [null, null]);
    const slot = groups.get(code);
    if (isShifted(ch)) slot[1] = ch;
    else slot[0] = ch;
  }
  for (const [code, [u, s]] of groups) {
    rows.push([u, s, null, code]);
  }
  addUsBaseDigits(rows);
  rows.push(
    ["`",  "~",  null, "Backquote"],
    ["-",  "_",  null, "Minus"],
    ["=",  "+",  null, "Equal"],
    ["[",  "{",  null, "BracketLeft"],
    ["]",  "}",  null, "BracketRight"],
    ["\\", "|",  null, "Backslash"],
    ["'",  "\"", null, "Quote"],
    [",",  "<",  null, "Comma"],
    [".",  ">",  null, "Period"],
    ["/",  "?",  null, "Slash"],
    [" ",  null, null, "Space"]
  );
  return rows;
})();

function buildLayout(rows) {
  const map = new Map();
  for (const [unshifted, shifted, altgr, code] of rows) {
    if (unshifted != null && !map.has(unshifted)) {
      map.set(unshifted, { code, shifted: false, altgr: false });
    }
    if (shifted != null && !map.has(shifted)) {
      map.set(shifted, { code, shifted: true, altgr: false });
    }
    if (altgr != null && !map.has(altgr)) {
      map.set(altgr, { code, shifted: false, altgr: true });
    }
  }
  return map;
}

// Public registry of supported guest keyboard layouts. The order here
// is the order of the dropdown in the UI; the first entry is also the
// default for users who have never picked one.
const KEYMAPS = [
  { id: "us",      label: "US QWERTY",         data: US_DATA },
  { id: "uk",      label: "UK QWERTY",         data: UK_DATA },
  { id: "fr",      label: "French (AZERTY)",   data: FR_DATA },
  { id: "de",      label: "German (QWERTZ)",   data: DE_DATA },
  { id: "es",      label: "Spanish",           data: ES_DATA },
  { id: "it",      label: "Italian",           data: IT_DATA },
  { id: "pt-br",   label: "Brazilian (ABNT2)", data: BR_DATA },
  { id: "nordic",  label: "Swedish / Finnish", data: NORDIC_DATA },
  { id: "dvorak",  label: "US Dvorak",         data: DVORAK_DATA },
  { id: "colemak", label: "US Colemak",        data: COLEMAK_DATA }
];

const DEFAULT_KEYMAP_ID = "us";
const KEYMAP_STORAGE_KEY = "ntnxConsoleLastKeymap";

// Built keymaps are cached lazily — building all 10 up-front would be
// fine size-wise but pointless work for users who only ever paste into
// US-QWERTY VMs.
const _builtKeymapCache = new Map();
function getKeymap(layoutId) {
  const id = KEYMAPS.some((k) => k.id === layoutId) ? layoutId : DEFAULT_KEYMAP_ID;
  if (!_builtKeymapCache.has(id)) {
    const def = KEYMAPS.find((k) => k.id === id);
    _builtKeymapCache.set(id, buildLayout(def.data));
  }
  return _builtKeymapCache.get(id);
}

let lastUsedKeymap = DEFAULT_KEYMAP_ID;
try {
  const saved = localStorage.getItem(KEYMAP_STORAGE_KEY);
  if (saved && KEYMAPS.some((k) => k.id === saved)) lastUsedKeymap = saved;
} catch (_e) { /* localStorage may be disabled in some browsers */ }

function rememberKeymapChoice(layoutId) {
  if (!KEYMAPS.some((k) => k.id === layoutId)) return;
  lastUsedKeymap = layoutId;
  try { localStorage.setItem(KEYMAP_STORAGE_KEY, layoutId); } catch (_e) { /* ignore */ }
}

// Resolve a Unicode code point into the (keysym, code, shifted, altgr)
// tuple the VNC server needs, using the supplied per-layout char map.
// Returns null for code points that can't be expressed as a single
// keystroke (which we then drop from the paste).
function keystrokeForCodePoint(cp, keyMap) {
  if (cp === 0x09) return { keysym: XK_TAB, code: "Tab", shifted: false, altgr: false };
  if (cp === 0x0a || cp === 0x0d) return { keysym: XK_RETURN, code: "Enter", shifted: false, altgr: false };
  if (cp === 0x08) return { keysym: XK_BACKSPACE, code: "Backspace", shifted: false, altgr: false };

  const ch = String.fromCodePoint(cp);
  const mapped = keyMap.get(ch);
  const keysym = keysymdef.lookup(cp);
  if (!keysym) return null;

  if (mapped) {
    return { keysym, code: mapped.code, shifted: mapped.shifted, altgr: mapped.altgr };
  }
  // Anything else (accented characters not in the chosen layout, unicode
  // punctuation, emoji, ...) gets sent without a physical-key hint. The
  // QEMU ext-key path will skip these (no scancode), and the plain-RFB
  // path delivers the keysym as-is — which most guests with a matching
  // X11/xkb keymap will still accept.
  return { keysym, code: "", shifted: false, altgr: false };
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

  const layoutId = session.keymap || lastUsedKeymap || DEFAULT_KEYMAP_ID;
  const keyMap = getKeymap(layoutId);
  const layoutLabel = (KEYMAPS.find((k) => k.id === layoutId) || {}).label || layoutId;

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

  // Track the current modifier state so a run of shifted (or AltGr-ed)
  // characters only toggles each modifier once at the boundaries,
  // instead of pressing/releasing it for every character. Shift and
  // AltGr are tracked independently because some characters need both
  // (rare, but possible on a few layouts).
  let shiftHeld = false;
  let altgrHeld = false;
  const setShift = (down) => {
    if (down === shiftHeld) return;
    rfb.sendKey(XK_SHIFT_L, "ShiftLeft", down);
    shiftHeld = down;
  };
  const setAltGr = (down) => {
    if (down === altgrHeld) return;
    rfb.sendKey(XK_ISO_LEVEL3, "AltRight", down);
    altgrHeld = down;
  };

  const cleanup = () => {
    try {
      if (shiftHeld) setShift(false);
      if (altgrHeld) setAltGr(false);
    } catch (_e) { /* connection may be gone */ }
  };

  try {
    for (const ch of codePoints) {
      if (myToken !== activePasteToken) { cleanup(); return; }
      if (session !== consoleSessions.find((s) => s.id === activeSessionId)) {
        cleanup();
        setStatus(`Paste cancelled (active console changed).`);
        return;
      }
      const cp = ch.codePointAt(0);
      const stroke = keystrokeForCodePoint(cp, keyMap);
      if (!stroke) { dropped++; continue; }

      // Order matters slightly: release modifiers we no longer need
      // *before* pressing new ones, so the guest never sees a stray
      // Shift+AltGr combo for one keystroke during transitions.
      if (!stroke.shifted && shiftHeld) setShift(false);
      if (!stroke.altgr && altgrHeld) setAltGr(false);
      if (stroke.shifted && !shiftHeld) setShift(true);
      if (stroke.altgr && !altgrHeld) setAltGr(true);

      rfb.sendKey(stroke.keysym, stroke.code, true);
      rfb.sendKey(stroke.keysym, stroke.code, false);
      typed++;

      const delay = (cp === 0x0a && perLineDelayMs) ? perLineDelayMs : perCharDelayMs;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    }
  } finally {
    cleanup();
  }

  const droppedSuffix = dropped ? ` (${dropped} char${dropped === 1 ? "" : "s"} not in ${layoutLabel} layout, skipped)` : "";
  setStatus(`Typed ${typed} character${typed === 1 ? "" : "s"} into ${session.vmName} (${layoutLabel}).${droppedSuffix}`);
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
  // Use a small per-keystroke delay (and a slightly longer pause after
  // each newline) so the same code path is safe everywhere: Windows
  // GUIs, Linux logins, and Linux terminals where a fast PTY can drop
  // bytes from bursty input. The cost is ~2ms per character — a
  // 200-char command is ~0.4s, well below the threshold of annoyance.
  await typeTextIntoSession(session, text, { perCharDelayMs: 2, perLineDelayMs: 25 });
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
      // Multi-user only: tell the chat server we've left this VM's
      // channel so presence is accurate even with no active tab.
      if (appConfig.multiUser && typeof onActiveSessionChangedForChat === "function") {
        onActiveSessionChangedForChat();
      }
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

    const newSession = {
      id: sessionId,
      vmUuid,
      vmName,
      rfb,
      screenEl,
      tabEl: null,
      // New tabs inherit whichever guest keymap the user picked most
      // recently (persisted in localStorage). They can change it on
      // the action bar at any time without affecting other open tabs.
      keymap: lastUsedKeymap || DEFAULT_KEYMAP_ID
    };
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
// App config probe + per-VM screenshots + multi-user chat
// =====================================================================
//
// /api/config tells the front-end which deployment mode the server is
// running in. In single-user mode we still wire up screenshot capture
// and browse (it's a useful local feature regardless), but the chat
// surface stays hidden -- there's no /ws-chat to talk to.

const appConfig = {
  multiUser: false,
  chatBufferSize: 200,
  screenshotMaxPerVm: 100,
  currentUser: null
};

async function loadAppConfig() {
  try {
    const resp = await fetch("/api/config", { credentials: "same-origin" });
    if (!resp.ok) return;
    const data = await resp.json();
    appConfig.multiUser = Boolean(data.multiUser);
    appConfig.chatBufferSize = Number(data.chatBufferSize) || appConfig.chatBufferSize;
    appConfig.screenshotMaxPerVm = Number(data.screenshotMaxPerVm) || appConfig.screenshotMaxPerVm;
    appConfig.currentUser = data.currentUser || null;
    if (appConfig.multiUser) {
      chatRoot.hidden = false;
    }
  } catch (_e) {
    /* probe failures are non-fatal; the app behaves as single-user */
  }
}

// ---- Screenshots --------------------------------------------------------

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error("FileReader error"));
    reader.readAsDataURL(blob);
  });
}

function activeConsoleCanvas() {
  const session = consoleSessions.find((s) => s.id === activeSessionId);
  if (!session) return { session: null, canvas: null };
  const canvas = session.screenEl.querySelector("canvas");
  return { session, canvas };
}

async function captureActiveScreenshot() {
  const { session, canvas } = activeConsoleCanvas();
  if (!session) {
    setStatus("Open a console first to take a screenshot.");
    return;
  }
  if (!canvas) {
    setStatus(`No canvas to capture for ${session.vmName}.`);
    return;
  }
  setStatus(`Capturing screenshot of ${session.vmName}...`);
  let blob;
  try {
    blob = await new Promise((resolve, reject) => {
      try { canvas.toBlob((b) => b ? resolve(b) : reject(new Error("toBlob returned null")), "image/png"); }
      catch (err) { reject(err); }
    });
  } catch (err) {
    setStatus(`Capture failed: ${err.message || err}`);
    return;
  }
  let pngBase64;
  try { pngBase64 = await blobToBase64(blob); }
  catch (err) {
    setStatus(`Capture failed: ${err.message || err}`);
    return;
  }
  try {
    const resp = await fetch(`/api/screenshots/${encodeURIComponent(session.vmUuid)}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pngBase64, width: canvas.width, height: canvas.height })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      setStatus(`Save failed: ${data.error || resp.statusText}`);
      return;
    }
    let msg = `Screenshot saved: ${data.filename}`;
    if (data.prunedCount > 0) {
      msg += ` (pruned ${data.prunedCount} older screenshot${data.prunedCount === 1 ? "" : "s"})`;
    }
    setStatus(msg);
  } catch (err) {
    setStatus(`Save failed: ${err.message || err}`);
  }
}

function fmtBytes(n) {
  if (!Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtTimestamp(tsMs) {
  if (!Number.isFinite(tsMs)) return "";
  const d = new Date(tsMs);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

async function refreshScreenshotBrowser(vmUuid, vmName) {
  screenshotBrowseGrid.innerHTML = "";
  screenshotBrowseEmpty.hidden = true;
  screenshotBrowseCount.textContent = "Loading...";
  let items = [];
  try {
    const resp = await fetch(`/api/screenshots/${encodeURIComponent(vmUuid)}`, {
      credentials: "same-origin"
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      screenshotBrowseCount.textContent = `Error: ${data.error || resp.statusText}`;
      return;
    }
    items = Array.isArray(data.items) ? data.items : [];
  } catch (err) {
    screenshotBrowseCount.textContent = `Error: ${err.message || err}`;
    return;
  }
  if (items.length === 0) {
    screenshotBrowseEmpty.hidden = false;
    screenshotBrowseCount.textContent = "";
    return;
  }
  screenshotBrowseCount.textContent = `${items.length} screenshot${items.length === 1 ? "" : "s"} (max ${appConfig.screenshotMaxPerVm} kept per VM)`;
  for (const item of items) {
    const url = `/api/screenshots/${encodeURIComponent(vmUuid)}/${encodeURIComponent(item.filename)}`;
    const tile = document.createElement("div");
    tile.className = "screenshot-tile";
    tile.innerHTML = `
      <a class="screenshot-tile-thumb" href="${url}" target="_blank" rel="noopener">
        <img loading="lazy" alt="" src="${url}" />
      </a>
      <div class="screenshot-tile-meta">
        <span title="${item.filename}">${fmtTimestamp(item.tsMs)}</span>
        <span>${fmtBytes(item.sizeBytes)}</span>
      </div>
      <div class="screenshot-tile-actions">
        <a href="${url}" download="${item.filename}">Download</a>
        <button type="button" class="screenshot-delete" data-filename="${item.filename}">Delete</button>
      </div>
    `;
    tile.querySelector(".screenshot-delete").addEventListener("click", async () => {
      if (!confirm(`Delete ${item.filename}?`)) return;
      try {
        const resp = await fetch(`/api/screenshots/${encodeURIComponent(vmUuid)}/${encodeURIComponent(item.filename)}`, {
          method: "DELETE",
          credentials: "same-origin"
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          setStatus(`Delete failed: ${err.error || resp.statusText}`);
          return;
        }
        await refreshScreenshotBrowser(vmUuid, vmName);
        setStatus(`Deleted ${item.filename}.`);
      } catch (err) {
        setStatus(`Delete failed: ${err.message || err}`);
      }
    });
    screenshotBrowseGrid.appendChild(tile);
  }
}

let screenshotBrowserVm = null;

function openScreenshotBrowser() {
  const session = consoleSessions.find((s) => s.id === activeSessionId);
  if (!session) {
    setStatus("Open a console first to browse screenshots.");
    return;
  }
  screenshotBrowserVm = { vmUuid: session.vmUuid, vmName: session.vmName };
  screenshotBrowseTitle.textContent = `Screenshots - ${session.vmName}`;
  screenshotBrowseModal.classList.add("open");
  refreshScreenshotBrowser(session.vmUuid, session.vmName);
}

function closeScreenshotBrowser() {
  screenshotBrowseModal.classList.remove("open");
  screenshotBrowserVm = null;
}

screenshotBrowseRefresh.addEventListener("click", () => {
  if (screenshotBrowserVm) {
    refreshScreenshotBrowser(screenshotBrowserVm.vmUuid, screenshotBrowserVm.vmName);
  }
});
screenshotBrowseCloseBtn.addEventListener("click", closeScreenshotBrowser);
screenshotBrowseModal.addEventListener("click", (event) => {
  if (event.target === screenshotBrowseModal) closeScreenshotBrowser();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && screenshotBrowseModal.classList.contains("open")) {
    closeScreenshotBrowser();
  }
});

screenshotBtn.addEventListener("click", () => { captureActiveScreenshot(); });
screenshotBrowseBtn.addEventListener("click", openScreenshotBrowser);

// ---- Multi-user chat ----------------------------------------------------

let chatSocket = null;
let chatReconnectTimer = null;
let chatReconnectAttempt = 0;
let chatHeartbeatTimer = null;
let chatPanelOpen = false;
let chatCurrentVmUuid = null;
let chatUnreadTotal = 0;
const chatStateByVm = new Map(); // vmUuid -> { messages: [], presence: [], unread: 0 }

function chatStateFor(vmUuid) {
  let state = chatStateByVm.get(vmUuid);
  if (!state) {
    state = { messages: [], presence: [], unread: 0 };
    chatStateByVm.set(vmUuid, state);
  }
  return state;
}

function chatTimeText(tsMs) {
  const d = new Date(tsMs);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function renderChatMessages() {
  if (!chatCurrentVmUuid) {
    chatMessagesEl.innerHTML = `<div class="chat-empty">Open a console to start chatting about it.</div>`;
    return;
  }
  const state = chatStateFor(chatCurrentVmUuid);
  if (!state.messages.length) {
    chatMessagesEl.innerHTML = `<div class="chat-empty">No messages yet for this VM. Say hi!</div>`;
    return;
  }
  // Detect whether the user is at the bottom *before* re-rendering so
  // we don't yank them off a scroll-up reading position when a new
  // message arrives.
  const wasAtBottom = chatMessagesEl.scrollTop + chatMessagesEl.clientHeight + 32 >= chatMessagesEl.scrollHeight;
  const html = state.messages.map((m) => {
    if (m.kind === "system") {
      return `<li class="chat-msg-system">${escapeHtml(m.text)} . ${chatTimeText(m.tsMs)}</li>`;
    }
    const selfClass = m.username === appConfig.currentUser ? " chat-msg-self" : "";
    const pendingClass = m.pending ? " chat-msg-pending" : "";
    return `<li class="chat-msg${selfClass}${pendingClass}">
      <div class="chat-msg-meta">
        <span class="chat-msg-user">${escapeHtml(m.username)}</span>
        <span class="chat-msg-time">${chatTimeText(m.tsMs)}</span>
      </div>
      <div class="chat-msg-text">${escapeHtml(m.text)}</div>
    </li>`;
  }).join("");
  chatMessagesEl.innerHTML = html;
  if (wasAtBottom || chatPanelOpen === false) {
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }
}

function renderChatPresence() {
  if (!chatCurrentVmUuid) {
    chatPresenceEl.textContent = "";
    return;
  }
  const state = chatStateFor(chatCurrentVmUuid);
  if (!state.presence.length) {
    chatPresenceEl.textContent = "Just you so far";
    return;
  }
  const others = state.presence.filter((u) => u !== appConfig.currentUser);
  if (state.presence.includes(appConfig.currentUser)) {
    if (others.length === 0) chatPresenceEl.textContent = "You only";
    else chatPresenceEl.textContent = `You + ${others.join(", ")}`;
  } else {
    chatPresenceEl.textContent = state.presence.join(", ");
  }
}

function renderChatHeader() {
  if (!chatCurrentVmUuid) {
    chatPanelTitle.textContent = "VM chat";
    chatPanelSubtitle.textContent = "No console selected";
    chatInput.disabled = true;
    chatSendBtn.disabled = true;
    return;
  }
  const session = consoleSessions.find((s) => s.vmUuid === chatCurrentVmUuid);
  chatPanelTitle.textContent = session ? session.vmName : "VM chat";
  chatPanelSubtitle.textContent = chatCurrentVmUuid;
  const live = chatSocket && chatSocket.readyState === WebSocket.OPEN;
  chatInput.disabled = !live;
  chatSendBtn.disabled = !live;
}

function setChatStatus(text) {
  if (!text) {
    chatStatusEl.hidden = true;
    chatStatusEl.textContent = "";
  } else {
    chatStatusEl.hidden = false;
    chatStatusEl.textContent = text;
  }
}

function updateChatBadge() {
  let total = 0;
  for (const state of chatStateByVm.values()) total += state.unread;
  chatUnreadTotal = total;
  if (total > 0) {
    chatLauncherBadge.hidden = false;
    chatLauncherBadge.textContent = total > 99 ? "99+" : String(total);
  } else {
    chatLauncherBadge.hidden = true;
  }
}

function chatSocketSend(payload) {
  if (!chatSocket || chatSocket.readyState !== WebSocket.OPEN) return false;
  try { chatSocket.send(JSON.stringify(payload)); return true; }
  catch (_e) { return false; }
}

function joinChannelForActiveSession() {
  const active = consoleSessions.find((s) => s.id === activeSessionId);
  const vmUuid = active ? active.vmUuid : null;
  chatCurrentVmUuid = vmUuid;
  // Visiting a VM clears its unread count.
  if (vmUuid) {
    const state = chatStateFor(vmUuid);
    state.unread = 0;
    updateChatBadge();
  }
  if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
    chatSocketSend({ type: "join", vmUuid });
  }
  renderChatHeader();
  renderChatPresence();
  renderChatMessages();
}

// Exported for setActiveSession() to call without a forward declaration.
function onActiveSessionChangedForChat() {
  if (!appConfig.multiUser) return;
  joinChannelForActiveSession();
}

function handleChatServerMessage(msg) {
  if (!msg || typeof msg.type !== "string") return;
  switch (msg.type) {
    case "hello": {
      if (msg.username) appConfig.currentUser = msg.username;
      // Once the socket says hello, sync to whatever channel the UI
      // currently thinks is active.
      joinChannelForActiveSession();
      break;
    }
    case "history": {
      if (!msg.vmUuid) return;
      const state = chatStateFor(msg.vmUuid);
      state.messages = (msg.messages || []).map((m) => ({ ...m, kind: "msg" }));
      if (msg.vmUuid === chatCurrentVmUuid) renderChatMessages();
      break;
    }
    case "presence": {
      if (!msg.vmUuid) return;
      const state = chatStateFor(msg.vmUuid);
      state.presence = Array.isArray(msg.users) ? msg.users.slice() : [];
      if (msg.vmUuid === chatCurrentVmUuid) renderChatPresence();
      break;
    }
    case "msg": {
      if (!msg.vmUuid) return;
      const state = chatStateFor(msg.vmUuid);
      // Replace any optimistic local row for this id, otherwise append.
      const existingIdx = state.messages.findIndex((m) => m.id === msg.id);
      const record = {
        id: msg.id,
        vmUuid: msg.vmUuid,
        username: msg.username,
        text: msg.text,
        tsMs: msg.tsMs,
        kind: "msg"
      };
      if (existingIdx >= 0) state.messages[existingIdx] = record;
      else state.messages.push(record);
      // Trim to the configured server-side buffer for parity.
      const limit = appConfig.chatBufferSize;
      if (state.messages.length > limit) {
        state.messages.splice(0, state.messages.length - limit);
      }
      if (msg.vmUuid === chatCurrentVmUuid) {
        renderChatMessages();
        if (chatPanelOpen && msg.username !== appConfig.currentUser) {
          state.unread = 0;
          updateChatBadge();
        }
      }
      // Unread accounting: count anyone else's messages in any channel
      // that isn't currently being viewed in an open panel.
      const isViewedNow = chatPanelOpen && msg.vmUuid === chatCurrentVmUuid;
      if (!isViewedNow && msg.username !== appConfig.currentUser) {
        state.unread += 1;
        updateChatBadge();
      }
      break;
    }
    case "system": {
      if (!msg.vmUuid) return;
      const state = chatStateFor(msg.vmUuid);
      state.messages.push({
        id: `sys-${Date.now()}-${Math.random()}`,
        vmUuid: msg.vmUuid,
        text: msg.text,
        tsMs: msg.tsMs,
        kind: "system"
      });
      if (msg.vmUuid === chatCurrentVmUuid) renderChatMessages();
      break;
    }
    case "error": {
      setChatStatus(msg.error || "Chat error");
      setTimeout(() => setChatStatus(""), 4000);
      break;
    }
    case "pong":
    default:
      break;
  }
}

function clearChatHeartbeat() {
  if (chatHeartbeatTimer) {
    clearInterval(chatHeartbeatTimer);
    chatHeartbeatTimer = null;
  }
}

function scheduleChatReconnect() {
  if (!appConfig.multiUser) return;
  if (chatReconnectTimer) return;
  chatReconnectAttempt += 1;
  // Capped exponential backoff: 1s, 2s, 4s, 8s, ... up to 30s.
  const delay = Math.min(30000, 1000 * Math.pow(2, Math.min(chatReconnectAttempt - 1, 5)));
  setChatStatus(`Disconnected. Reconnecting in ${Math.round(delay / 1000)}s...`);
  chatReconnectTimer = setTimeout(() => {
    chatReconnectTimer = null;
    openChatSocket();
  }, delay);
}

function openChatSocket() {
  if (!appConfig.multiUser) return;
  if (chatSocket && (chatSocket.readyState === WebSocket.CONNECTING || chatSocket.readyState === WebSocket.OPEN)) {
    return;
  }
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  const url = `${scheme}://${window.location.host}/ws-chat`;
  let ws;
  try { ws = new WebSocket(url); }
  catch (err) {
    setChatStatus(`Chat unavailable: ${err.message || err}`);
    scheduleChatReconnect();
    return;
  }
  chatSocket = ws;
  ws.addEventListener("open", () => {
    chatReconnectAttempt = 0;
    setChatStatus("");
    renderChatHeader();
    clearChatHeartbeat();
    chatHeartbeatTimer = setInterval(() => {
      chatSocketSend({ type: "ping", tsMs: Date.now() });
    }, 30 * 1000);
  });
  ws.addEventListener("message", (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch (_e) { return; }
    handleChatServerMessage(msg);
  });
  ws.addEventListener("close", (event) => {
    clearChatHeartbeat();
    chatSocket = null;
    renderChatHeader();
    if (event.code === 4401) {
      setChatStatus("Chat sign-in required. Re-log in to NRCC and reopen the chat.");
      return;
    }
    if (appConfig.multiUser && session.loggedIn) {
      scheduleChatReconnect();
    }
  });
  ws.addEventListener("error", () => {
    setChatStatus("Chat connection error.");
  });
}

function teardownChat() {
  if (chatReconnectTimer) {
    clearTimeout(chatReconnectTimer);
    chatReconnectTimer = null;
  }
  clearChatHeartbeat();
  if (chatSocket) {
    try { chatSocket.close(); } catch (_e) { /* ignore */ }
    chatSocket = null;
  }
  chatReconnectAttempt = 0;
  chatStateByVm.clear();
  chatCurrentVmUuid = null;
  chatPanelOpen = false;
  chatPanel.hidden = true;
  chatLauncher.classList.remove("is-open");
  updateChatBadge();
  renderChatHeader();
  renderChatPresence();
  renderChatMessages();
  setChatStatus("");
}

function toggleChatPanel(forceState) {
  const next = typeof forceState === "boolean" ? forceState : chatPanel.hidden;
  chatPanel.hidden = !next;
  chatPanelOpen = next;
  chatLauncher.classList.toggle("is-open", next);
  if (next) {
    // Clear unread for the channel we're now actively viewing.
    if (chatCurrentVmUuid) {
      chatStateFor(chatCurrentVmUuid).unread = 0;
      updateChatBadge();
    }
    renderChatMessages();
    renderChatPresence();
    renderChatHeader();
    setTimeout(() => { try { chatInput.focus(); } catch (_e) { /* ignore */ } }, 50);
  }
}

chatLauncher.addEventListener("click", () => toggleChatPanel());
chatPanelClose.addEventListener("click", () => toggleChatPanel(false));

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  if (!chatCurrentVmUuid) {
    setChatStatus("Open a console to send a message.");
    setTimeout(() => setChatStatus(""), 3000);
    return;
  }
  if (!chatSocketSend({ type: "msg", text })) {
    setChatStatus("Chat is reconnecting; please retry shortly.");
    return;
  }
  chatInput.value = "";
});

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
pasteKeymapSelect.addEventListener("change", () => {
  const newId = pasteKeymapSelect.value;
  if (!KEYMAPS.some((k) => k.id === newId)) return;
  const active = consoleSessions.find((s) => s.id === activeSessionId);
  if (active) {
    active.keymap = newId;
  }
  rememberKeymapChoice(newId);
  const label = (KEYMAPS.find((k) => k.id === newId) || {}).label || newId;
  if (active) {
    setStatus(`Paste keymap for ${active.vmName} set to ${label}.`);
  } else {
    setStatus(`Default paste keymap for new tabs set to ${label}.`);
  }
});
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
// Probe deployment mode early so the chat surface is gated correctly.
// Fires-and-forgets; the app behaves as single-user until it resolves.
loadAppConfig();
// Reflect the saved guest-keymap preference in the action bar even
// before any tabs are open, so the user knows what new tabs will inherit.
pasteKeymapSelect.value = lastUsedKeymap;
showLoginScreen();
setTimeout(() => {
  if (loginPcHostInput.value && loginUsernameInput.value) {
    loginPasswordInput.focus();
  } else {
    loginPcHostInput.focus();
  }
}, 100);
