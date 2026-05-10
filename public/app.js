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
const screenshotBrowseTitle = document.getElementById("screenshotBrowseTitle");

const recordBtn = document.getElementById("recordBtn");
const recordBtnTimer = document.getElementById("recordBtnTimer");
const recordBrowseBtn = document.getElementById("recordBrowseBtn");
const recordingBrowseModal = document.getElementById("recordingBrowseModal");
const recordingBrowseTitle = document.getElementById("recordingBrowseTitle");

const scriptLauncher = document.getElementById("scriptLauncher");
const scriptLibraryModal = document.getElementById("scriptLibraryModal");
const scriptFolderPane = document.getElementById("scriptFolderPane");
const scriptGrid = document.getElementById("scriptGrid");
const scriptEmpty = document.getElementById("scriptEmpty");
const scriptCount = document.getElementById("scriptCount");
const scriptBreadcrumbs = document.getElementById("scriptBreadcrumbs");
const scriptCloseBtn = document.getElementById("scriptCloseBtn");
const scriptRefreshBtn = document.getElementById("scriptRefreshBtn");
const scriptNewFolderBtn = document.getElementById("scriptNewFolderBtn");
const scriptNewBtn = document.getElementById("scriptNewBtn");
const scriptEditorModal = document.getElementById("scriptEditorModal");
const scriptEditorTitle = document.getElementById("scriptEditorTitle");
const scriptEditorLabel = document.getElementById("scriptEditorLabel");
const scriptEditorLanguage = document.getElementById("scriptEditorLanguage");
const scriptEditorDescription = document.getElementById("scriptEditorDescription");
const scriptEditorBody = document.getElementById("scriptEditorBody");
const scriptEditorError = document.getElementById("scriptEditorError");
const scriptEditorCancel = document.getElementById("scriptEditorCancel");
const scriptEditorSave = document.getElementById("scriptEditorSave");

const toastEl = document.getElementById("toast");

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

const settingsBtn = document.getElementById("settingsBtn");
const settingsModal = document.getElementById("settingsModal");
const settingsThemeInput = document.getElementById("settingsTheme");
const settingsIdleTimeoutInput = document.getElementById("settingsIdleTimeout");
const settingsLoggingEnabledInput = document.getElementById("settingsLoggingEnabled");
const settingsLoggingHint = document.getElementById("settingsLoggingHint");
const settingsLoggingDisabledHint = document.getElementById("settingsLoggingDisabledHint");
const settingsBetaEnabledInput = document.getElementById("settingsBetaEnabled");
const settingsCancelBtn = document.getElementById("settingsCancel");
const settingsSaveBtn = document.getElementById("settingsSave");
const settingsVersionLabel = document.getElementById("settingsVersionLabel");
const settingsUpdateBtn = document.getElementById("settingsUpdateBtn");
const settingsUpdateStatus = document.getElementById("settingsUpdateStatus");

const sshCredsModal = document.getElementById("sshCredsModal");
const sshCredsTargetLabel = document.getElementById("sshCredsTarget");
const sshCredsUsernameInput = document.getElementById("sshCredsUsername");
const sshCredsUseKeyInput = document.getElementById("sshCredsUseKey");
const sshCredsPasswordRow = document.getElementById("sshCredsPasswordRow");
const sshCredsPasswordInput = document.getElementById("sshCredsPassword");
const sshCredsKeyRow = document.getElementById("sshCredsKeyRow");
const sshCredsPrivateKeyInput = document.getElementById("sshCredsPrivateKey");
const sshCredsPassphraseRow = document.getElementById("sshCredsPassphraseRow");
const sshCredsPassphraseInput = document.getElementById("sshCredsPassphrase");
const sshCredsRememberInput = document.getElementById("sshCredsRemember");
const sshCredsErrorEl = document.getElementById("sshCredsError");
const sshCredsCancelBtn = document.getElementById("sshCredsCancel");
const sshCredsSubmitBtn = document.getElementById("sshCredsSubmit");

const sshIpPickerModal = document.getElementById("sshIpPickerModal");
const sshIpPickerMsg = document.getElementById("sshIpPickerMsg");
const sshIpPickerListEl = document.getElementById("sshIpPickerList");
const sshIpPickerCancelBtn = document.getElementById("sshIpPickerCancel");

const rdpCredsModal = document.getElementById("rdpCredsModal");
const rdpCredsTargetLabel = document.getElementById("rdpCredsTarget");
const rdpCredsUsernameInput = document.getElementById("rdpCredsUsername");
const rdpCredsDomainInput = document.getElementById("rdpCredsDomain");
const rdpCredsPasswordInput = document.getElementById("rdpCredsPassword");
const rdpCredsSecuritySelect = document.getElementById("rdpCredsSecurity");
const rdpCredsIgnoreCertInput = document.getElementById("rdpCredsIgnoreCert");
const rdpCredsRememberInput = document.getElementById("rdpCredsRemember");
const rdpCredsErrorEl = document.getElementById("rdpCredsError");
const rdpCredsCancelBtn = document.getElementById("rdpCredsCancel");
const rdpCredsSubmitBtn = document.getElementById("rdpCredsSubmit");

const rdpIpPickerModal = document.getElementById("rdpIpPickerModal");
const rdpIpPickerMsg = document.getElementById("rdpIpPickerMsg");
const rdpIpPickerListEl = document.getElementById("rdpIpPickerList");
const rdpIpPickerCancelBtn = document.getElementById("rdpIpPickerCancel");

// =====================================================================
// Storage keys
// =====================================================================

const profileStorageKey = "ntnxConsoleProfile";
const favoritesStorageKey = "ntnxConsoleFavorites";
const userPrefsStorageKey = "nrcc.userPrefs.v1";

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
  // Beta: render small SSH / RDP pills if the port scanner has seen
  // them open. The wrapping span carries data-feature="vmPortScan" so
  // the existing feature-flag refresh hides the entire group when
  // the beta toggle is off.
  const portStatus = vmPortStatus.get(vm.uuid);
  let portPills = "";
  if (portStatus && (portStatus.ssh || portStatus.rdp)) {
    const parts = [];
    if (portStatus.ssh) parts.push(`<span class="vm-port-pill" data-protocol="ssh" title="SSH (port 22) reachable">SSH</span>`);
    if (portStatus.rdp) parts.push(`<span class="vm-port-pill" data-protocol="rdp" title="RDP (port 3389) reachable">RDP</span>`);
    portPills = `<span data-feature="vmPortScan">${parts.join("")}</span>`;
  }
  row.innerHTML = `
    <button class="star ${fav ? "is-fav" : ""}" title="${fav ? "Remove favorite" : "Add favorite"}">${fav ? "★" : "☆"}</button>
    <div class="vm-item ${isLive ? "" : "is-loading"}">
      <div class="vm-name">${escapeHtml(vm.name || vm.uuid)}<span class="state-pill" data-state="${escapeHtml(normPower)}">${escapeHtml(pillLabel)}</span>${portPills}</div>
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
    // Self-signed TLS and hidden / system VMs are always allowed; the
    // corresponding login-form checkboxes were removed because every
    // real-world deployment relied on both being on.
    const tlsSkipVerify = true;
    const includeHiddenVms = true;
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

    // Start the auto-poll that pins a "update available" dot on the
    // gear icon when GitHub has a newer build.
    startUpdateBadgePoll();

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
  // Stop the update-availability poll and clear the gear-icon badge
  // so the login screen doesn't show a stale dot.
  stopUpdateBadgePoll();
  // Beta: drop any cached SSH / RDP credentials and stop the port
  // scanner.
  if (typeof sshCredsCache !== "undefined") sshCredsCache.clear();
  if (typeof rdpCredsCache !== "undefined") rdpCredsCache.clear();
  if (typeof vmPortScanner !== "undefined") vmPortScanner.clear();
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
  // Beta: schedule a TCP port scan over the freshly-loaded VM IPs so
  // the SSH/RDP availability pills (and the "Open SSH" right-click
  // item) light up. The scanner is a no-op when the beta feature is
  // off, so leaving the call unconditional is safe.
  vmPortScanner.scheduleProbe(vmCache);

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
  recordBtn.disabled = !has;
  recordBrowseBtn.disabled = !has;
  // Recording UI state follows the active session (each tab can be
  // recording independently of the others).
  refreshRecordButtonForActiveSession();
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
  if (!session) return;
  // RDP path: Guacamole speaks X keysyms directly, same wire-level
  // values noVNC uses so the constants below work for either client.
  if (session.kind === "rdp" && session.rdp && session.rdp.client) {
    const c = session.rdp.client;
    c.sendKeyEvent(1, 0xffe3); // Ctrl down
    c.sendKeyEvent(1, 0xffe9); // Alt down
    c.sendKeyEvent(1, 0xffff); // Delete down
    c.sendKeyEvent(0, 0xffff); // Delete up
    c.sendKeyEvent(0, 0xffe9); // Alt up
    c.sendKeyEvent(0, 0xffe3); // Ctrl up
    setStatus(`Sent Ctrl+Alt+Del to ${session.vmName}.`);
    logEvent("console.ctrl-alt-del", session.vmUuid);
    return;
  }
  if (!session.rfb) return; // No-op for SSH tabs (xterm.js doesn't have a sendKey API)
  const rfb = session.rfb;
  rfb.sendKey(0xffe3, "ControlLeft", true);
  rfb.sendKey(0xffe9, "AltLeft", true);
  rfb.sendKey(0xffff, "Delete", true);
  rfb.sendKey(0xffff, "Delete", false);
  rfb.sendKey(0xffe9, "AltLeft", false);
  rfb.sendKey(0xffe3, "ControlLeft", false);
  setStatus(`Sent Ctrl+Alt+Del to ${session.vmName}.`);
  logEvent("console.ctrl-alt-del", session.vmUuid);
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
  if (!session) return;
  const text = await readClipboardOrWarn();
  if (text == null) return;
  // SSH tabs: write straight into the WS as bytes. The terminal
  // renders the echo from the remote side so we get correct visual
  // feedback for free, and we don't need the per-key Shift/AltGr
  // dance the VNC path uses.
  if (session.kind === "ssh") {
    if (!session.ssh || !session.ssh.ws || session.ssh.ws.readyState !== WebSocket.OPEN) {
      setStatus(`SSH session for ${session.vmName} is not connected.`);
      return;
    }
    setStatus(`Pasting ${text.length} chars into ${session.vmName}...`);
    try {
      session.ssh.ws.send(new TextEncoder().encode(text));
      logEvent("console.paste", session.vmUuid, { length: text.length, transport: "ssh" });
      setStatus(`Pasted into ${session.vmName}.`);
    } catch (err) {
      setStatus(`Paste failed: ${err.message || err}`);
    }
    return;
  }
  if (session.kind === "rdp") {
    if (!session.rdp || !session.rdp.client) {
      setStatus(`RDP session for ${session.vmName} is not connected.`);
      return;
    }
    // Guacamole's recommended path for clipboard paste: open an
    // outbound stream tagged with the text mimetype, write the
    // payload, then end. The remote (RDP guest) sees a clipboard
    // update. We do NOT type the text key-by-key because RDP carries
    // a real clipboard channel.
    setStatus(`Pasting ${text.length} chars into ${session.vmName}...`);
    try {
      const Guacamole = window.Guacamole;
      const stream = session.rdp.client.createClipboardStream("text/plain");
      const writer = new Guacamole.StringWriter(stream);
      writer.sendText(text);
      writer.sendEnd();
      logEvent("console.paste", session.vmUuid, { length: text.length, transport: "rdp" });
      setStatus(`Pasted into ${session.vmName}.`);
    } catch (err) {
      setStatus(`Paste failed: ${err.message || err}`);
    }
    return;
  }
  if (!session.rfb) return;
  setStatus(`Typing clipboard into ${session.vmName}...`, { spinner: true });
  // Use a small per-keystroke delay (and a slightly longer pause after
  // each newline) so the same code path is safe everywhere: Windows
  // GUIs, Linux logins, and Linux terminals where a fast PTY can drop
  // bytes from bursty input. The cost is ~2ms per character — a
  // 200-char command is ~0.4s, well below the threshold of annoyance.
  await typeTextIntoSession(session, text, { perCharDelayMs: 2, perLineDelayMs: 25 });
  logEvent("console.paste", session.vmUuid, { length: text.length });
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
  // Finalize an in-flight recording for this session before tearing
  // down the canvas underneath it. We don't await -- the upload runs
  // in the background and the modal will pick up the saved file on
  // next refresh.
  if (s.recording) {
    try { stopRecordingForSession(s, { reason: "session-closed" }); }
    catch (_e) { /* best-effort */ }
  }
  if (s.kind === "ssh") {
    // SSH tabs use a WebSocket + xterm.js, not noVNC. Tear them down
    // in their own helper which closes the WS, disposes the
    // terminal, and disconnects the resize observer.
    try { teardownSshSession(s); } catch (_error) { /* ignore */ }
    logEvent("console.ssh.close", s.vmUuid, { reason: "session-closed" });
  } else if (s.kind === "rdp") {
    // RDP tabs use guacamole-common-js + a WS bridge to guacd.
    try { teardownRdpSession(s); } catch (_error) { /* ignore */ }
    logEvent("console.rdp.close", s.vmUuid, { reason: "session-closed" });
  } else {
    try {
      s.rfb.disconnect();
    } catch (_error) {
      /* ignore disconnect issues */
    }
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

    // PE-fallback handling. Two flavors:
    //   1) CVMs - snap.peHost is set up-front when the VM list is built.
    //   2) Regular AHV VMs on a PC build that doesn't ship the v4
    //      generate-console-token action. The server resolves the PE
    //      external IP for us and returns it in `data.peHost` along with
    //      `needPeCredentials: true`. We adopt that peHost into tokenBody
    //      and retry through the same prompt-and-resubmit flow as CVMs.
    if (!resp.ok && (data?.needPeCredentials || resp.status === 401)) {
      const peHostForPrompt = snap.peHost || data?.peHost || "";
      if (peHostForPrompt) {
        if (!snap.peHost && data?.peHost) {
          snap.peHost = data.peHost;
          tokenBody.peHost = data.peHost;
        }
        await dropPeCreds(peHostForPrompt);
        if (quiet) {
          throw new Error(`PE credentials for ${peHostForPrompt} are no longer valid.`);
        }
        setStatus(`PE credentials needed for ${peHostForPrompt}.`);
        const ok = await promptForPeCreds(peHostForPrompt);
        if (!ok) {
          setStatus("Cancelled. PE credentials are required for this VM.");
          return;
        }
        setStatus(`Retrying console token via PE ${peHostForPrompt}...`, { spinner: true });
        resp = await fetch("/api/console-token", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(tokenBody)
        });
        data = await resp.json();
      }
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

  // Beta: SSH menu item is always present when the user has enabled
  // the sshConsole flag AND the VM has at least one known IP. The
  // label adapts to scan state so the user can tell at a glance
  // whether the port is confirmed reachable, looks closed, or
  // hasn't been scanned yet. Clicking will run an on-demand probe
  // when needed and fall back to an IP picker if port 22 looks
  // closed everywhere. RDP is intentionally not wired yet -- see
  // the deferred plan; the marker below is the hook the follow-up
  // will use.
  if (featureFlags.isEnabled("sshConsole")) {
    const liveVmForMenu = getVmByUuid(vmUuid);
    const snapForMenu = liveVmForMenu || (favStore.vmMeta && favStore.vmMeta[vmUuid]) || null;
    const ipsForMenu = liveVmForMenu
      ? (Array.isArray(liveVmForMenu.ipAddresses) ? liveVmForMenu.ipAddresses : (liveVmForMenu.ipAddress ? [liveVmForMenu.ipAddress] : []))
      : (snapForMenu && snapForMenu.ipAddress ? [snapForMenu.ipAddress] : []);
    if (ipsForMenu.length) {
      const sep = document.createElement("div");
      sep.className = "ctx-menu-sep";
      ctxMenu.appendChild(sep);
      const sshItem = document.createElement("div");
      sshItem.className = "ctx-menu-item";
      sshItem.dataset.feature = "sshConsole";
      const portStatus = vmPortStatus.get(vmUuid);
      let label;
      if (portStatus && portStatus.ssh && portStatus.preferredIp && portStatus.preferredIp.ssh) {
        label = `Open SSH (${portStatus.preferredIp.ssh})`;
      } else if (portStatus && !portStatus.ssh) {
        label = "Open SSH (try anyway)";
      } else {
        label = "Open SSH (probe...)";
      }
      sshItem.innerHTML = `<span class="ctx-icon">$</span><span>${escapeHtml(label)}</span>`;
      sshItem.addEventListener("click", () => {
        hideContextMenu();
        openSshFor(vmUuid);
      });
      ctxMenu.appendChild(sshItem);
    }
  }
  // Beta: RDP menu item. Mirrors the SSH block above but consults
  // the rdp pillar of the probe cache (port 3389) and routes through
  // openRdpFor / guacd. Hidden unless rdpConsole is enabled.
  if (featureFlags.isEnabled("rdpConsole")) {
    const liveVmForMenu = getVmByUuid(vmUuid);
    const snapForMenu = liveVmForMenu || (favStore.vmMeta && favStore.vmMeta[vmUuid]) || null;
    const ipsForMenu = liveVmForMenu
      ? (Array.isArray(liveVmForMenu.ipAddresses) ? liveVmForMenu.ipAddresses : (liveVmForMenu.ipAddress ? [liveVmForMenu.ipAddress] : []))
      : (snapForMenu && snapForMenu.ipAddress ? [snapForMenu.ipAddress] : []);
    if (ipsForMenu.length) {
      // Only add a separator if the SSH block above didn't already
      // add one (i.e. sshConsole is off, or the VM has no IPs known
      // to that path).
      if (!ctxMenu.lastChild || !ctxMenu.lastChild.classList || !ctxMenu.lastChild.classList.contains("ctx-menu-sep")) {
        if (!featureFlags.isEnabled("sshConsole")) {
          const sep = document.createElement("div");
          sep.className = "ctx-menu-sep";
          ctxMenu.appendChild(sep);
        }
      }
      const rdpItem = document.createElement("div");
      rdpItem.className = "ctx-menu-item";
      rdpItem.dataset.feature = "rdpConsole";
      const portStatus = vmPortStatus.get(vmUuid);
      let label;
      if (portStatus && portStatus.rdp && portStatus.preferredIp && portStatus.preferredIp.rdp) {
        label = `Open RDP (${portStatus.preferredIp.rdp})`;
      } else if (portStatus && !portStatus.rdp) {
        label = "Open RDP (try anyway)";
      } else {
        label = "Open RDP (probe...)";
      }
      rdpItem.innerHTML = `<span class="ctx-icon">▢</span><span>${escapeHtml(label)}</span>`;
      rdpItem.addEventListener("click", () => {
        hideContextMenu();
        openRdpFor(vmUuid);
      });
      ctxMenu.appendChild(rdpItem);
    }
  }

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
  // Route through getSessionCanvas so SSH (xterm capture) and RDP
  // (Guacamole flatten) tabs produce thumbnails too, not just the
  // VNC <canvas>.
  const canvas = (typeof getSessionCanvas === "function")
    ? getSessionCanvas(s)
    : s.screenEl.querySelector("canvas");
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
  // Best-effort abort of any in-flight recordings so the server can
  // sweep the temp file rather than waiting for the 1h orphan timer.
  for (const s of consoleSessions) {
    if (!s.recording) continue;
    try {
      const url = `/api/recordings/${encodeURIComponent(s.vmUuid)}/abort`;
      const blob = new Blob(
        [JSON.stringify({ recordingId: s.recording.recordingId })],
        { type: "application/json" }
      );
      navigator.sendBeacon(url, blob);
    } catch (_e) { /* ignore */ }
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
  recording: { fps: 10, bitrate: 600_000, maxBytes: 524_288_000, maxPerVm: 50 },
  scripts: { maxBytes: 262_144 },
  currentUser: null,
  loggingAvailable: false,
  featureFlags: {},
  appVersion: "",
  updateAvailable: false
};

async function loadAppConfig() {
  try {
    const resp = await fetch("/api/config", { credentials: "same-origin" });
    if (!resp.ok) return;
    const data = await resp.json();
    appConfig.multiUser = Boolean(data.multiUser);
    appConfig.chatBufferSize = Number(data.chatBufferSize) || appConfig.chatBufferSize;
    appConfig.screenshotMaxPerVm = Number(data.screenshotMaxPerVm) || appConfig.screenshotMaxPerVm;
    if (data.recording && typeof data.recording === "object") {
      appConfig.recording = { ...appConfig.recording, ...data.recording };
    }
    if (data.scripts && typeof data.scripts === "object") {
      appConfig.scripts = { ...appConfig.scripts, ...data.scripts };
    }
    appConfig.currentUser = data.currentUser || null;
    appConfig.loggingAvailable = Boolean(data.loggingAvailable);
    appConfig.featureFlags = (data.featureFlags && typeof data.featureFlags === "object")
      ? data.featureFlags
      : {};
    appConfig.appVersion = typeof data.appVersion === "string" ? data.appVersion : "";
    appConfig.updateAvailable = Boolean(data.updateAvailable);
    if (appConfig.multiUser) {
      chatRoot.hidden = false;
      document.body.classList.add("has-chat");
    }
    // The settings UI shows a different hint depending on whether the
    // server permits logging at all, and the feature-flag visibility
    // pass picks up the brand-new flag registry. Both run safely even
    // when the user is on the login screen.
    refreshSettingsServerHints();
    refreshSettingsVersionLabel();
    refreshSettingsUpdateButton();
    featureFlags.refresh();
  } catch (_e) {
    /* probe failures are non-fatal; the app behaves as single-user */
  }
}

// =====================================================================
// User preferences (theme, idle timeout, logging, beta features)
// =====================================================================
//
// All four settings are per-browser preferences persisted to
// localStorage under userPrefsStorageKey. They are loaded once at boot
// (so the theme is applied before the user even sees the login form)
// and re-applied every time the user clicks Save in the settings
// dialog. The server is not aware of these values; the only thing
// it sees is the per-event `?clientLogging=1` query string the
// log-event helper appends when the toggle is on.

const userPrefs = {
  theme: "light",
  idleTimeoutMin: 15,
  loggingEnabled: false,
  betaFeaturesEnabled: false
};

function loadUserPrefs() {
  try {
    const raw = localStorage.getItem(userPrefsStorageKey);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      if (typeof parsed.theme === "string") userPrefs.theme = parsed.theme;
      if (Number.isFinite(parsed.idleTimeoutMin)) {
        userPrefs.idleTimeoutMin = Math.max(0, Number(parsed.idleTimeoutMin));
      }
      if (typeof parsed.loggingEnabled === "boolean") {
        userPrefs.loggingEnabled = parsed.loggingEnabled;
      }
      if (typeof parsed.betaFeaturesEnabled === "boolean") {
        userPrefs.betaFeaturesEnabled = parsed.betaFeaturesEnabled;
      }
    }
  } catch (_e) {
    /* corrupted JSON shouldn't break the app */
  }
}

function saveUserPrefs(patch) {
  Object.assign(userPrefs, patch || {});
  try {
    localStorage.setItem(userPrefsStorageKey, JSON.stringify(userPrefs));
  } catch (_e) {
    /* localStorage may be disabled */
  }
  applyUserPrefs();
}

function resolvedTheme() {
  if (userPrefs.theme === "dark" || userPrefs.theme === "light") {
    return userPrefs.theme;
  }
  // "system" or anything we don't recognise: defer to OS preference.
  try {
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
  } catch (_e) { /* ignore */ }
  return "light";
}

function applyUserPrefs() {
  document.documentElement.setAttribute("data-theme", resolvedTheme());
  installIdleTimer(userPrefs.idleTimeoutMin * 60 * 1000);
  if (typeof featureFlags === "object") featureFlags.refresh();
}

// React to OS theme changes when the user has chosen "Match system".
try {
  const mq = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
  if (mq && typeof mq.addEventListener === "function") {
    mq.addEventListener("change", () => {
      if (userPrefs.theme === "system") {
        document.documentElement.setAttribute("data-theme", resolvedTheme());
      }
    });
  }
} catch (_e) { /* matchMedia may not exist in very old browsers */ }

// =====================================================================
// Idle-logout timer
// =====================================================================
//
// Reset on any UI activity (mouse/keyboard/touch/wheel) and on input
// inside any console pane (RFB doesn't bubble its keystrokes to
// document because they're consumed by the canvas). When the timer
// expires we route through the existing logout(), which clears the
// in-memory creds and closes every console tab.

let idleTimerHandle = null;
let idleTimerMs = 0;
const idleTimerEvents = ["mousemove", "mousedown", "keydown", "touchstart", "wheel"];

function resetIdleTimer() {
  if (!idleTimerMs) return;
  if (idleTimerHandle) clearTimeout(idleTimerHandle);
  idleTimerHandle = setTimeout(() => {
    if (!session.loggedIn) return;
    setStatus("Logged out due to inactivity.");
    logout();
  }, idleTimerMs);
}

function installIdleTimer(ms) {
  idleTimerMs = Math.max(0, Number(ms) || 0);
  if (idleTimerHandle) {
    clearTimeout(idleTimerHandle);
    idleTimerHandle = null;
  }
  idleTimerEvents.forEach((evt) => {
    window.removeEventListener(evt, resetIdleTimer, { capture: true });
  });
  if (!idleTimerMs) return;
  idleTimerEvents.forEach((evt) => {
    window.addEventListener(evt, resetIdleTimer, { capture: true, passive: true });
  });
  resetIdleTimer();
}

// =====================================================================
// Feature flags (beta / GA gating)
// =====================================================================
//
// The server publishes a `featureFlags` registry in /api/config with a
// stage of "ga" or "beta" per known feature. Any DOM element marked
// with data-feature="<id>" is hidden when the matching flag is "beta"
// AND the user has not opted in to beta features. GA features are
// always visible. Code paths that aren't tied to a specific element
// can call featureFlags.isEnabled("<id>") directly.

const featureFlags = {
  isEnabled(id) {
    const entry = appConfig.featureFlags && appConfig.featureFlags[id];
    const stage = entry && typeof entry.stage === "string" ? entry.stage : "ga";
    if (stage === "ga") return true;
    return Boolean(userPrefs.betaFeaturesEnabled);
  },
  refresh() {
    document.querySelectorAll("[data-feature]").forEach((el) => {
      const id = el.getAttribute("data-feature");
      if (!id) return;
      const enabled = featureFlags.isEnabled(id);
      el.hidden = !enabled;
    });
  }
};

// =====================================================================
// Settings dialog
// =====================================================================

function refreshSettingsServerHints() {
  // The "logging is server-disabled" message replaces the regular hint
  // when NRCC_LOGGING isn't set on the server. We disable the toggle
  // in that case so the user can't pretend it's on.
  if (!settingsLoggingHint || !settingsLoggingDisabledHint || !settingsLoggingEnabledInput) return;
  if (appConfig.loggingAvailable) {
    settingsLoggingHint.hidden = false;
    settingsLoggingHint.removeAttribute("data-disabled");
    settingsLoggingDisabledHint.hidden = true;
    settingsLoggingEnabledInput.disabled = false;
  } else {
    settingsLoggingHint.setAttribute("data-disabled", "true");
    settingsLoggingDisabledHint.hidden = false;
    settingsLoggingEnabledInput.disabled = true;
  }
}

function refreshSettingsVersionLabel() {
  if (!settingsVersionLabel) return;
  const v = (appConfig.appVersion || "").trim();
  settingsVersionLabel.textContent = v || "unknown";
}

// =====================================================================
// In-app self-update (Settings -> Update button)
// =====================================================================
//
// The button is hidden entirely if the operator disabled NRCC_UPDATE_*
// on the server. Otherwise clicking it:
//   1. POSTs /api/update/check, which reads build.info from the
//      configured GitHub repo and compares it to APP_VERSION.
//   2. If we're already current, shows a transient inline status.
//   3. If a newer build exists, confirm() then POST /api/update/install.
//      The server replies 202 immediately and exits as soon as the
//      git pull / clone-swap + npm install finishes; the client
//      polls /api/health until it comes back, then reloads the page.
//
// In addition to the manual click flow, an auto-poll runs in the
// background after login (interval = UPDATE_BADGE_POLL_MS, default
// 30 min) so a small dot appears on the gear icon as soon as a new
// build lands on GitHub. The poll uses the server's cached check
// result so we don't hammer raw.githubusercontent.com.

let _updatePollHandle = null;
let _updateBadgePollHandle = null;
// Most recent /api/update/check result, populated by both manual
// clicks and the background poll. Used to decorate the modal when
// the user opens it (so the latest build / cache age are visible
// immediately) and to drive the gear-icon badge.
let _lastUpdateInfo = null;
const UPDATE_BADGE_POLL_MS = 30 * 60 * 1000; // 30 minutes
const UPDATE_BADGE_FIRST_DELAY_MS = 5_000;   // wait briefly after login before the first poll

function setUpdateBadge(visible) {
  if (!settingsBtn) return;
  if (visible) {
    settingsBtn.setAttribute("data-has-update", "true");
    const latest = _lastUpdateInfo && _lastUpdateInfo.latest;
    settingsBtn.setAttribute("aria-label", latest
      ? `Open settings (update available: ${latest})`
      : "Open settings (update available)");
    settingsBtn.title = latest
      ? `Settings - update available (${latest})`
      : "Settings - update available";
  } else {
    settingsBtn.removeAttribute("data-has-update");
    settingsBtn.setAttribute("aria-label", "Open settings");
    settingsBtn.title = "Settings";
  }
}

async function probeUpdateAvailability(opts) {
  const force = opts && opts.force;
  if (!appConfig.updateAvailable) return null;
  try {
    const url = "/api/update/check" + (force ? "?force=1" : "");
    const resp = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    if (!resp.ok) return null;
    const info = await resp.json().catch(() => null);
    if (!info || typeof info !== "object") return null;
    _lastUpdateInfo = info;
    setUpdateBadge(Boolean(info.updateAvailable));
    return info;
  } catch (_e) {
    return null;
  }
}

function startUpdateBadgePoll() {
  if (!appConfig.updateAvailable) return;
  if (_updateBadgePollHandle) return;
  // First probe is delayed slightly so we don't pile a GitHub fetch
  // on top of the login burst (config + VM list + chat WS).
  setTimeout(() => { probeUpdateAvailability(); }, UPDATE_BADGE_FIRST_DELAY_MS);
  _updateBadgePollHandle = setInterval(() => { probeUpdateAvailability(); }, UPDATE_BADGE_POLL_MS);
}

function stopUpdateBadgePoll() {
  if (_updateBadgePollHandle) {
    clearInterval(_updateBadgePollHandle);
    _updateBadgePollHandle = null;
  }
  _lastUpdateInfo = null;
  setUpdateBadge(false);
}

function setSettingsUpdateStatus(text, state) {
  if (!settingsUpdateStatus) return;
  if (!text) {
    settingsUpdateStatus.hidden = true;
    settingsUpdateStatus.textContent = "";
    settingsUpdateStatus.removeAttribute("data-state");
    return;
  }
  settingsUpdateStatus.hidden = false;
  settingsUpdateStatus.textContent = text;
  if (state) settingsUpdateStatus.setAttribute("data-state", state);
  else settingsUpdateStatus.removeAttribute("data-state");
}

function refreshSettingsUpdateButton() {
  if (!settingsUpdateBtn) return;
  if (!appConfig.updateAvailable) {
    settingsUpdateBtn.hidden = true;
    setSettingsUpdateStatus("");
    return;
  }
  settingsUpdateBtn.hidden = false;
  settingsUpdateBtn.disabled = false;
  settingsUpdateBtn.textContent = "Update";
  // If the background poll has already discovered a new build, surface
  // it the moment the modal opens so the user doesn't have to click
  // Update just to see the version number.
  if (_lastUpdateInfo && _lastUpdateInfo.updateAvailable) {
    setSettingsUpdateStatus(`Update available: ${_lastUpdateInfo.latest}`, "ok");
  } else {
    setSettingsUpdateStatus("");
  }
}

async function pollHealthUntilReady(onReady, opts) {
  const max = (opts && opts.maxAttempts) || 60; // ~2 min at 2s
  const interval = (opts && opts.interval) || 2000;
  if (_updatePollHandle) {
    clearInterval(_updatePollHandle);
    _updatePollHandle = null;
  }
  let attempts = 0;
  _updatePollHandle = setInterval(async () => {
    attempts += 1;
    try {
      const resp = await fetch("/api/health", { credentials: "same-origin", cache: "no-store" });
      if (resp.ok) {
        const data = await resp.json().catch(() => null);
        if (data && data.ok) {
          clearInterval(_updatePollHandle);
          _updatePollHandle = null;
          onReady();
          return;
        }
      }
    } catch (_e) {
      /* server is restarting; keep polling */
    }
    if (attempts >= max) {
      clearInterval(_updatePollHandle);
      _updatePollHandle = null;
      setSettingsUpdateStatus(
        "Server did not come back within the expected time. Please reload the page manually.",
        "error"
      );
      if (settingsUpdateBtn) settingsUpdateBtn.disabled = false;
    }
  }, interval);
}

async function handleUpdateClick() {
  if (!settingsUpdateBtn) return;
  settingsUpdateBtn.disabled = true;
  settingsUpdateBtn.textContent = "Checking...";
  setSettingsUpdateStatus("Checking GitHub for a newer build...", "");

  let info;
  try {
    // Force-refresh from GitHub on an explicit click; the user wants
    // an authoritative answer, not whatever the background poll
    // happened to cache.
    const resp = await fetch("/api/update/check?force=1", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    info = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      setSettingsUpdateStatus(
        (info && info.error) || `Update check failed (HTTP ${resp.status}).`,
        "error"
      );
      settingsUpdateBtn.disabled = false;
      settingsUpdateBtn.textContent = "Update";
      return;
    }
  } catch (err) {
    setSettingsUpdateStatus(`Update check failed: ${err && err.message ? err.message : err}`, "error");
    settingsUpdateBtn.disabled = false;
    settingsUpdateBtn.textContent = "Update";
    return;
  }

  // Sync the cached state and the gear-icon badge with the fresh
  // result so they reflect reality even if the answer changed
  // between the last background poll and now.
  _lastUpdateInfo = info;
  setUpdateBadge(Boolean(info.updateAvailable));

  if (!info.updateAvailable) {
    setSettingsUpdateStatus("You are running the latest build!", "ok");
    settingsUpdateBtn.disabled = false;
    settingsUpdateBtn.textContent = "Update";
    setTimeout(() => {
      if (settingsUpdateStatus && settingsUpdateStatus.textContent === "You are running the latest build!") {
        setSettingsUpdateStatus("");
      }
    }, 5000);
    return;
  }

  const ok = window.confirm(
    `A newer build is available.\n\n` +
    `Current: ${info.current}\n` +
    `Latest:  ${info.latest}\n\n` +
    `Install now? The server will restart and you may briefly lose connection.`
  );
  if (!ok) {
    setSettingsUpdateStatus(`Update available: ${info.latest} (install cancelled).`, "");
    settingsUpdateBtn.disabled = false;
    settingsUpdateBtn.textContent = "Update";
    return;
  }

  setSettingsUpdateStatus(`Installing ${info.latest}... server is restarting.`, "");
  settingsUpdateBtn.textContent = "Updating...";

  try {
    const resp = await fetch("/api/update/install", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    if (resp.status !== 202) {
      const data = await resp.json().catch(() => ({}));
      setSettingsUpdateStatus(
        (data && data.error) || `Install request failed (HTTP ${resp.status}).`,
        "error"
      );
      settingsUpdateBtn.disabled = false;
      settingsUpdateBtn.textContent = "Update";
      return;
    }
  } catch (err) {
    // Network failure here can also mean the server already exited
    // before our request finished; fall through to the health poll.
    console.warn("[update] install POST failed; falling through to health poll", err);
  }

  // Give the server a moment to start the upgrade before we begin
  // hammering /api/health. The first few attempts are expected to
  // fail (server is git-pulling and npm-installing).
  setTimeout(() => {
    pollHealthUntilReady(() => {
      setSettingsUpdateStatus("Update complete - reloading.", "ok");
      setTimeout(() => location.reload(), 600);
    });
  }, 3000);
}

function openSettingsModal() {
  if (!settingsModal) return;
  settingsThemeInput.value = userPrefs.theme;
  settingsIdleTimeoutInput.value = String(userPrefs.idleTimeoutMin);
  settingsLoggingEnabledInput.checked = Boolean(userPrefs.loggingEnabled && appConfig.loggingAvailable);
  settingsBetaEnabledInput.checked = Boolean(userPrefs.betaFeaturesEnabled);
  refreshSettingsServerHints();
  refreshSettingsVersionLabel();
  refreshSettingsUpdateButton();
  settingsModal.classList.add("open");
  setTimeout(() => settingsThemeInput.focus(), 50);
}

function closeSettingsModal() {
  if (settingsModal) settingsModal.classList.remove("open");
}

function saveSettingsModal() {
  const themeVal = settingsThemeInput.value;
  const timeoutVal = Number(settingsIdleTimeoutInput.value);
  const loggingVal = Boolean(settingsLoggingEnabledInput.checked && appConfig.loggingAvailable);
  const betaVal = Boolean(settingsBetaEnabledInput.checked);
  saveUserPrefs({
    theme: ["light", "dark", "system"].includes(themeVal) ? themeVal : "light",
    idleTimeoutMin: Number.isFinite(timeoutVal) ? Math.max(0, timeoutVal) : 0,
    loggingEnabled: loggingVal,
    betaFeaturesEnabled: betaVal
  });
  closeSettingsModal();
  setStatus("Settings updated.");
  logEvent("settings.saved", null, {
    theme: userPrefs.theme,
    idleTimeoutMin: userPrefs.idleTimeoutMin,
    loggingEnabled: userPrefs.loggingEnabled,
    betaFeaturesEnabled: userPrefs.betaFeaturesEnabled
  });
}

if (settingsBtn) settingsBtn.addEventListener("click", openSettingsModal);
if (settingsCancelBtn) settingsCancelBtn.addEventListener("click", closeSettingsModal);
if (settingsSaveBtn) settingsSaveBtn.addEventListener("click", saveSettingsModal);
if (settingsUpdateBtn) settingsUpdateBtn.addEventListener("click", handleUpdateClick);
if (settingsModal) {
  settingsModal.addEventListener("click", (event) => {
    if (event.target === settingsModal) closeSettingsModal();
  });
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && settingsModal && settingsModal.classList.contains("open")) {
    closeSettingsModal();
  }
});

// =====================================================================
// VM port-scan (beta: vmPortScan)
// =====================================================================
//
// Posts batches of {uuid, ipAddresses[]} to /api/probe/ports after the
// VM list arrives. Results are merged into vmPortStatus and the VM
// list is re-rendered so the SSH / RDP availability pills appear.
// The same map is consulted by openSshFor() to pick a target IP.

// uuid -> { scannedAt, ips: { ip: { port: status } }, ssh, rdp,
//           preferredIp: { ssh, rdp } }
const vmPortStatus = new Map();
const vmPortScanner = (() => {
  let queue = [];
  let timer = null;
  let inFlight = false;
  // Server endpoint caps each request at 200 VMs; we send a smaller
  // batch to keep latency tight on big PCs.
  const BATCH_SIZE = 50;
  const DEBOUNCE_MS = 500;

  function cancelTimer() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  async function flush() {
    if (inFlight || !queue.length) { timer = null; return; }
    if (!featureFlags.isEnabled("vmPortScan")) { queue = []; timer = null; return; }
    const batch = queue.splice(0, BATCH_SIZE);
    inFlight = true;
    try {
      const resp = await fetch("/api/probe/ports", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vms: batch })
      });
      if (resp.status === 503) {
        // Server has the feature disabled. Stop scheduling; the user's
        // beta toggle won't change that.
        queue = [];
        timer = null;
        inFlight = false;
        return;
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const results = (data && data.results) || {};
      for (const uuid of Object.keys(results)) {
        vmPortStatus.set(uuid, results[uuid]);
      }
      // Coalesce one re-render per batch so 500 VMs don't trigger
      // 500 layout passes.
      try { renderVmList(); } catch (_e) { /* ignore */ }
    } catch (_err) {
      // Probe failures are non-fatal; the pills just won't appear.
    } finally {
      inFlight = false;
      if (queue.length) {
        timer = setTimeout(flush, DEBOUNCE_MS);
      } else {
        timer = null;
      }
    }
  }

  return {
    scheduleProbe(vms) {
      if (!Array.isArray(vms) || !vms.length) return;
      if (!featureFlags.isEnabled("vmPortScan")) return;
      // Build the lean payload (uuid + ipAddresses only) and skip VMs
      // with no IPs, since the server has nothing to probe for them.
      const seen = new Set(queue.map((v) => v.uuid));
      for (const vm of vms) {
        if (!vm || !vm.uuid) continue;
        if (seen.has(vm.uuid)) continue;
        // Skip if we already have a fresh-enough cached entry; the
        // server caches too, but skipping the round-trip saves a
        // request entirely.
        const existing = vmPortStatus.get(vm.uuid);
        if (existing && (Date.now() - existing.scannedAt) < 60_000) continue;
        const ips = Array.isArray(vm.ipAddresses) ? vm.ipAddresses : (vm.ipAddress ? [vm.ipAddress] : []);
        if (!ips.length) continue;
        queue.push({ uuid: vm.uuid, ipAddresses: ips });
        seen.add(vm.uuid);
      }
      cancelTimer();
      timer = setTimeout(flush, DEBOUNCE_MS);
    },
    clear() {
      vmPortStatus.clear();
      queue = [];
      cancelTimer();
    },
    // On-demand probe of a single VM. Bypasses the debounced queue so
    // the caller (typically openSshFor) can await a fresh result. The
    // backing /api/probe/ports endpoint is server-cached for
    // NRCC_PROBE_CACHE_TTL_MS, so back-to-back clicks are cheap.
    async probeNow(vm) {
      if (!vm || !vm.uuid) return null;
      const ips = Array.isArray(vm.ipAddresses) ? vm.ipAddresses : (vm.ipAddress ? [vm.ipAddress] : []);
      if (!ips.length) return null;
      try {
        const resp = await fetch("/api/probe/ports", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vms: [{ uuid: vm.uuid, ipAddresses: ips }] })
        });
        if (!resp.ok) return vmPortStatus.get(vm.uuid) || null;
        const data = await resp.json();
        const result = data && data.results && data.results[vm.uuid];
        if (result) {
          vmPortStatus.set(vm.uuid, result);
          try { renderVmList(); } catch (_e) { /* ignore */ }
        }
        return result || null;
      } catch (_err) {
        return vmPortStatus.get(vm.uuid) || null;
      }
    }
  };
})();

// =====================================================================
// SSH browser console (beta: sshConsole)
// =====================================================================
//
// Opens an SSH session as a console tab using xterm.js + a server
// WebSocket proxy that runs the actual ssh2.Client. Because xterm's
// WebGL renderer publishes a single <canvas> into the same console
// pane that noVNC uses for VNC tabs, the existing screenshot and
// recording pipelines work without modification.

// Lazy-loaded ESM modules. We only pull them in when the user
// actually opens an SSH tab so the noVNC-only happy path doesn't
// pay the bundle cost.
let _xtermModulesPromise = null;
function loadXtermModules() {
  if (_xtermModulesPromise) return _xtermModulesPromise;
  _xtermModulesPromise = Promise.all([
    import("/vendor/xterm/lib/xterm.mjs"),
    import("/vendor/xterm-addon-fit/lib/addon-fit.mjs"),
    import("/vendor/xterm-addon-webgl/lib/addon-webgl.mjs")
  ]).then(([xtermMod, fitMod, webglMod]) => ({
    Terminal: xtermMod.Terminal,
    FitAddon: fitMod.FitAddon,
    WebglAddon: webglMod.WebglAddon
  }));
  return _xtermModulesPromise;
}

// vmUuid -> { username, password, privateKey, passphrase }. Cleared
// on logout. Populated only when the user ticks "Remember for this
// browser session" in the SSH credentials modal.
const sshCredsCache = new Map();

function promptForSshCreds(vmUuid, host, port, prefill) {
  return new Promise((resolve) => {
    if (!sshCredsModal) { resolve(null); return; }
    const seed = prefill || sshCredsCache.get(vmUuid) || {};
    sshCredsTargetLabel.textContent = `${host}:${port}`;
    sshCredsUsernameInput.value = seed.username || "root";
    sshCredsUseKeyInput.checked = !!seed.privateKey;
    sshCredsPasswordInput.value = "";
    sshCredsPrivateKeyInput.value = seed.privateKey || "";
    sshCredsPassphraseInput.value = "";
    sshCredsRememberInput.checked = !!seed.remember;
    sshCredsErrorEl.style.display = "none";
    sshCredsErrorEl.textContent = "";

    const syncRows = () => {
      const useKey = sshCredsUseKeyInput.checked;
      sshCredsPasswordRow.hidden = useKey;
      sshCredsKeyRow.hidden = !useKey;
      sshCredsPassphraseRow.hidden = !useKey;
    };
    syncRows();

    sshCredsModal.classList.add("open");
    setTimeout(() => sshCredsUsernameInput.focus(), 50);

    const cleanup = () => {
      sshCredsModal.classList.remove("open");
      sshCredsCancelBtn.removeEventListener("click", onCancel);
      sshCredsSubmitBtn.removeEventListener("click", onSubmit);
      sshCredsUseKeyInput.removeEventListener("change", syncRows);
      sshCredsModal.removeEventListener("keydown", onKey);
      // Wipe sensitive inputs so they don't linger in the DOM.
      sshCredsPasswordInput.value = "";
      sshCredsPrivateKeyInput.value = "";
      sshCredsPassphraseInput.value = "";
    };
    const onCancel = () => { cleanup(); resolve(null); };
    const onSubmit = () => {
      const username = sshCredsUsernameInput.value.trim();
      const useKey = sshCredsUseKeyInput.checked;
      const password = useKey ? "" : sshCredsPasswordInput.value;
      const privateKey = useKey ? sshCredsPrivateKeyInput.value.trim() : "";
      const passphrase = useKey ? sshCredsPassphraseInput.value : "";
      if (!username) {
        sshCredsErrorEl.textContent = "Username is required.";
        sshCredsErrorEl.style.display = "block";
        return;
      }
      if (useKey && !privateKey) {
        sshCredsErrorEl.textContent = "Paste the private key (OpenSSH format) or untick the key checkbox.";
        sshCredsErrorEl.style.display = "block";
        return;
      }
      if (!useKey && !password) {
        sshCredsErrorEl.textContent = "Password is required.";
        sshCredsErrorEl.style.display = "block";
        return;
      }
      const remember = sshCredsRememberInput.checked;
      const creds = { username, password, privateKey, passphrase, remember };
      cleanup();
      resolve(creds);
    };
    const onKey = (event) => {
      if (event.key === "Escape") { event.preventDefault(); onCancel(); }
    };
    sshCredsCancelBtn.addEventListener("click", onCancel);
    sshCredsSubmitBtn.addEventListener("click", onSubmit);
    sshCredsUseKeyInput.addEventListener("change", syncRows);
    sshCredsModal.addEventListener("keydown", onKey);
  });
}

function teardownSshSession(s) {
  const ssh = s.ssh;
  if (!ssh) return;
  if (ssh.resizeObserver) {
    try { ssh.resizeObserver.disconnect(); } catch (_e) { /* ignore */ }
  }
  if (ssh.capture) {
    try { ssh.capture.dispose(); } catch (_e) { /* ignore */ }
  }
  if (ssh.ws) {
    try { ssh.ws.close(1000, "client-close"); } catch (_e) { /* ignore */ }
  }
  if (ssh.term) {
    try { ssh.term.dispose(); } catch (_e) { /* ignore */ }
  }
  s.ssh = null;
}

// Picker modal for SSH target IP. Resolves with the chosen IP string,
// or null on cancel. Each row shows the per-IP probe status (open /
// refused / timeout / unknown) so the user can make an informed pick.
function promptForSshIp(vmName, ips, statusEntry, message) {
  return new Promise((resolve) => {
    if (!sshIpPickerModal) { resolve(null); return; }
    sshIpPickerMsg.textContent = message || `Choose an IP to SSH into ${vmName}.`;
    sshIpPickerListEl.innerHTML = "";
    const ipsObj = (statusEntry && statusEntry.ips) || {};
    ips.forEach((ip) => {
      const row = document.createElement("div");
      row.className = "ssh-ip-picker-row";
      const portStatus = (ipsObj[ip] && ipsObj[ip]["22"]) || "unknown";
      row.innerHTML = `
        <span class="ssh-ip-addr">${escapeHtml(ip)}</span>
        <span class="ssh-ip-status" data-status="${escapeHtml(portStatus)}">${escapeHtml(portStatus)}</span>
      `;
      row.addEventListener("click", () => {
        cleanup();
        resolve(ip);
      });
      sshIpPickerListEl.appendChild(row);
    });
    sshIpPickerModal.classList.add("open");

    const cleanup = () => {
      sshIpPickerModal.classList.remove("open");
      sshIpPickerCancelBtn.removeEventListener("click", onCancel);
      sshIpPickerModal.removeEventListener("keydown", onKey);
    };
    const onCancel = () => { cleanup(); resolve(null); };
    const onKey = (event) => {
      if (event.key === "Escape") { event.preventDefault(); onCancel(); }
    };
    sshIpPickerCancelBtn.addEventListener("click", onCancel);
    sshIpPickerModal.addEventListener("keydown", onKey);
  });
}

async function openSshFor(vmUuid) {
  if (!session.loggedIn) return;
  if (!featureFlags.isEnabled("sshConsole")) return;

  const liveVm = getVmByUuid(vmUuid);
  const snap = liveVm || favStore.vmMeta[vmUuid];
  const vmName = (liveVm?.name) || (snap && snap.name) || vmUuid;
  const port = 22;
  // Build the list of candidate IPs from whichever source has the
  // freshest data. Live VM list wins; favorite snapshot is a
  // single-IP fallback for when the user right-clicks a VM that's
  // not currently in the filtered list.
  const ips = liveVm
    ? (Array.isArray(liveVm.ipAddresses) ? liveVm.ipAddresses : (liveVm.ipAddress ? [liveVm.ipAddress] : []))
    : (snap && snap.ipAddress ? [snap.ipAddress] : []);
  if (!ips.length) {
    setStatus(`No known IPs for ${vmName}; cannot SSH.`);
    return;
  }

  // Resolve the target host. Order of preference:
  //   1) probe cache says port 22 is open on a specific IP -> use it
  //   2) probe cache exists but port 22 looked closed everywhere ->
  //      ask the user to pick (or auto-use the only IP if there's one)
  //   3) probe cache missing/stale -> run a fresh on-demand probe,
  //      then re-evaluate using rule 1 or 2
  let host = null;
  let statusEntry = vmPortStatus.get(vmUuid);
  if (statusEntry && statusEntry.preferredIp && statusEntry.preferredIp.ssh) {
    host = statusEntry.preferredIp.ssh;
  } else {
    if (!statusEntry || (Date.now() - statusEntry.scannedAt) > 60_000) {
      setStatus(`Probing ${vmName} for SSH...`, { spinner: true });
      const probeVmInput = liveVm || { uuid: vmUuid, ipAddresses: ips };
      const fresh = await vmPortScanner.probeNow(probeVmInput);
      statusEntry = fresh || vmPortStatus.get(vmUuid) || null;
    }
    if (statusEntry && statusEntry.preferredIp && statusEntry.preferredIp.ssh) {
      host = statusEntry.preferredIp.ssh;
    } else {
      // Port 22 looked closed on all known IPs. Let the user try
      // anyway -- a firewall might be blocking the probe SYN while
      // still permitting the real SSH source IP.
      const message = ips.length === 1
        ? `SSH port 22 was not detected on ${ips[0]}. Try anyway?`
        : `SSH port 22 was not detected on any of ${vmName}'s IPs. Pick one to try anyway:`;
      const picked = await promptForSshIp(vmName, ips, statusEntry, message);
      if (!picked) { setStatus("SSH cancelled."); return; }
      host = picked;
    }
  }
  if (!host) { setStatus("SSH cancelled."); return; }

  // Prompt unless we already have remembered creds for this VM.
  let creds = sshCredsCache.get(vmUuid) || null;
  if (!creds) {
    creds = await promptForSshCreds(vmUuid, host, port, null);
    if (!creds) { setStatus("SSH cancelled."); return; }
  }

  setStatus(`Authorising SSH session to ${vmName} (${host})...`, { spinner: true });

  // Reserve the session id with the server. The server validates
  // host against the probe cache (SSRF guard) and will only accept
  // the WS upgrade with this id once.
  let startData;
  try {
    const resp = await fetch("/api/ssh/start", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vmUuid,
        host,
        port,
        username: creds.username,
        password: creds.password || "",
        privateKey: creds.privateKey || "",
        passphrase: creds.passphrase || ""
      })
    });
    startData = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(startData.error || `HTTP ${resp.status}`);
  } catch (err) {
    setStatus(`SSH start failed: ${err.message || err}`);
    // Wipe potentially-bad cached creds so the next click re-prompts.
    if (creds && creds.remember) sshCredsCache.delete(vmUuid);
    return;
  }

  // Honour "Remember for this browser session" only after the start
  // call accepted the credentials shape; cache nothing on validation
  // errors above.
  if (creds.remember) sshCredsCache.set(vmUuid, creds);

  let xterm;
  try {
    xterm = await loadXtermModules();
  } catch (err) {
    setStatus(`Failed to load terminal bundle: ${err.message || err}`);
    return;
  }

  const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const screenEl = document.createElement("div");
  screenEl.className = "console-pane is-ssh";
  // Inline status overlay so the user sees something between the
  // POST returning and ssh2 finishing its TCP/auth handshake.
  const overlay = document.createElement("div");
  overlay.className = "ssh-status-overlay";
  overlay.textContent = `Connecting to ${vmName} (${host}:${port})...`;
  screenEl.appendChild(overlay);
  screenStageEl.appendChild(screenEl);

  const term = new xterm.Terminal({
    cursorBlink: true,
    convertEol: true,
    fontFamily: 'Menlo, Consolas, "DejaVu Sans Mono", monospace',
    fontSize: 13,
    theme: { background: "#000000" }
  });
  const fitAddon = new xterm.FitAddon();
  term.loadAddon(fitAddon);
  term.open(screenEl);
  // WebGL renderer is what publishes the single <canvas> the
  // screenshot + recording pipeline reads from. We MUST pass
  // `preserveDrawingBuffer: true` -- without it the WebGL
  // framebuffer is auto-cleared after each present, so canvas.toBlob
  // (screenshots) and canvas.captureStream (recordings) read a
  // blank/black canvas. If WebGL refuses to initialise (rare;
  // mostly headless CI) we fall back to the default DOM renderer;
  // recording will not work then but the terminal still functions.
  let webglAddon = null;
  try {
    webglAddon = new xterm.WebglAddon(true);
    term.loadAddon(webglAddon);
  } catch (err) {
    console.warn("[ssh] WebGL renderer unavailable, falling back to DOM renderer:", err);
  }
  try { fitAddon.fit(); } catch (_e) { /* ignore */ }
  // Capture canvas: a private offscreen 2D canvas that we paint
  // ourselves from xterm's text buffer. The WebGL render canvas is
  // unreliable to capture from -- xterm composites several canvases
  // inside .xterm-screen, the WebGL canvas uses dirty-region updates
  // and (depending on browser) may have an empty / partial drawing
  // buffer at the moment toBlob / captureStream reads it. Instead
  // we walk `term.buffer.active` and paint a faithful 2D copy on
  // every parsed write, on cursor move, on resize, and on a slow
  // tick to catch cursor blink. Both the screenshot path and the
  // recording captureStream path read from this canvas, completely
  // bypassing xterm's renderer for capture purposes.
  const sshCapture = createSshCaptureCanvas(term, screenEl);

  const wsScheme = location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${wsScheme}//${location.host}${startData.websocketUrl}`;
  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";

  let resizeObserver = null;
  let pendingResize = null;
  const sendResize = () => {
    if (ws.readyState !== WebSocket.OPEN) return;
    try { fitAddon.fit(); } catch (_e) { /* ignore */ }
    const cols = Math.max(2, Math.floor(term.cols || 80));
    const rows = Math.max(2, Math.floor(term.rows || 24));
    try { ws.send(JSON.stringify({ type: "resize", cols, rows })); } catch (_e) { /* ignore */ }
  };
  const debouncedResize = () => {
    if (pendingResize) clearTimeout(pendingResize);
    pendingResize = setTimeout(sendResize, 80);
  };

  ws.addEventListener("open", () => {
    overlay.textContent = `Authenticating to ${vmName}...`;
    sendResize();
  });
  ws.addEventListener("message", (event) => {
    if (typeof event.data === "string") {
      let msg;
      try { msg = JSON.parse(event.data); } catch (_e) { return; }
      if (msg && msg.type === "ready") {
        overlay.hidden = true;
        setStatus(`SSH connected: ${vmName}`);
      }
      return;
    }
    // Binary frame: shell bytes
    const buf = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : event.data;
    term.write(buf);
  });
  ws.addEventListener("close", (event) => {
    overlay.hidden = false;
    overlay.textContent = `SSH disconnected: ${vmName} (${event.code})`;
    setStatus(`SSH disconnected: ${vmName}`);
    logEvent("console.ssh.close", vmUuid, { code: event.code });
  });
  ws.addEventListener("error", () => {
    setStatus(`SSH transport error: ${vmName}`);
  });

  term.onData((data) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(new TextEncoder().encode(data)); } catch (_e) { /* ignore */ }
  });

  resizeObserver = new ResizeObserver(debouncedResize);
  resizeObserver.observe(screenEl);

  const newSession = {
    id: sessionId,
    vmUuid,
    vmName,
    kind: "ssh",
    rfb: null,
    screenEl,
    tabEl: null,
    keymap: lastUsedKeymap || DEFAULT_KEYMAP_ID,
    ssh: { ws, term, fitAddon, resizeObserver, host, port, username: creds.username, overlay, capture: sshCapture, webglAddon }
  };
  const tabEl = createSessionTab(newSession);
  // Distinguish SSH tabs visually so the user can tell at a glance
  // which protocol each tab speaks. The .is-ssh class drives the
  // green tab styling and label prefix.
  tabEl.classList.add("is-ssh");
  const tabLabelSpan = tabEl.querySelector("span:first-child");
  if (tabLabelSpan) tabLabelSpan.textContent = `ssh: ${vmName}`;
  newSession.tabEl = tabEl;
  consoleSessions.push(newSession);
  consoleTabsEl.appendChild(tabEl);
  setActiveSession(sessionId);

  // Focus the terminal so keystrokes go straight in.
  setTimeout(() => { try { term.focus(); } catch (_e) { /* ignore */ } }, 50);
  logEvent("console.ssh.open", vmUuid, { host, port });
}

// =====================================================================
// RDP browser console (beta: rdpConsole)
// =====================================================================
//
// Mirrors openSshFor: resolve target IP via probe cache (or run an
// on-demand probe / IP picker), prompt for credentials, POST to
// /api/rdp/start to authorise the session, then open the WebSocket
// to /ws-rdp/<id>. The browser side uses guacamole-common-js to
// render the Guacamole protocol stream the server proxies from
// guacd. Display element gets injected into a console pane like
// noVNC's <canvas>; the existing screenshot + recording pipelines
// read from a parallel 2D capture canvas (display.flatten() result
// painted on each frame), the same trick we use for SSH.

// vmUuid -> { username, password, domain, security, ignoreCert,
//             remember }. Cleared on logout.
const rdpCredsCache = new Map();

let _guacamolePromise = null;
function loadGuacamoleModule() {
  if (window.Guacamole) return Promise.resolve(window.Guacamole);
  if (_guacamolePromise) return _guacamolePromise;
  // Different guacamole-common-js npm releases ship their browser
  // bundle at slightly different paths (dist/ vs lib/, hyphen vs
  // dot in the filename). Try them in order until one loads, so we
  // don't break on a future package layout change. The bundle drops
  // the Guacamole namespace onto window when it executes.
  const candidatePaths = [
    "/vendor/guacamole-common-js/dist/guacamole-common-js.min.js",
    "/vendor/guacamole-common-js/dist/guacamole-common.min.js",
    "/vendor/guacamole-common-js/dist/guacamole-common-js.js",
    "/vendor/guacamole-common-js/dist/guacamole-common.js",
    "/vendor/guacamole-common-js/dist/all.min.js",
    "/vendor/guacamole-common-js/dist/all.js",
    "/vendor/guacamole-common-js/lib/all.min.js",
    "/vendor/guacamole-common-js/lib/all.js"
  ];
  function tryLoad(idx) {
    return new Promise((resolve, reject) => {
      if (idx >= candidatePaths.length) {
        reject(new Error("Could not locate the guacamole-common-js browser bundle. Check that `npm install` has been run."));
        return;
      }
      const script = document.createElement("script");
      script.src = candidatePaths[idx];
      script.async = true;
      script.onload = () => {
        if (window.Guacamole) resolve(window.Guacamole);
        else tryLoad(idx + 1).then(resolve, reject);
      };
      script.onerror = () => { tryLoad(idx + 1).then(resolve, reject); };
      document.head.appendChild(script);
    });
  }
  _guacamolePromise = tryLoad(0).catch((err) => { _guacamolePromise = null; throw err; });
  return _guacamolePromise;
}

function promptForRdpCreds(vmUuid, host, port, prefill) {
  return new Promise((resolve) => {
    if (!rdpCredsModal) { resolve(null); return; }
    const seed = prefill || rdpCredsCache.get(vmUuid) || {};
    rdpCredsTargetLabel.textContent = `${host}:${port}`;
    rdpCredsUsernameInput.value = seed.username || "Administrator";
    rdpCredsDomainInput.value = seed.domain || "";
    rdpCredsPasswordInput.value = "";
    rdpCredsSecuritySelect.value = seed.security || "any";
    rdpCredsIgnoreCertInput.checked = (typeof seed.ignoreCert === "boolean") ? seed.ignoreCert : true;
    rdpCredsRememberInput.checked = !!seed.remember;
    rdpCredsErrorEl.style.display = "none";
    rdpCredsErrorEl.textContent = "";

    rdpCredsModal.classList.add("open");
    setTimeout(() => rdpCredsUsernameInput.focus(), 50);

    const cleanup = () => {
      rdpCredsModal.classList.remove("open");
      rdpCredsCancelBtn.removeEventListener("click", onCancel);
      rdpCredsSubmitBtn.removeEventListener("click", onSubmit);
      rdpCredsModal.removeEventListener("keydown", onKey);
      // Wipe the password field so it doesn't linger in the DOM.
      rdpCredsPasswordInput.value = "";
    };
    const onCancel = () => { cleanup(); resolve(null); };
    const onSubmit = () => {
      const username = rdpCredsUsernameInput.value.trim();
      const password = rdpCredsPasswordInput.value;
      if (!username) {
        rdpCredsErrorEl.textContent = "Username is required.";
        rdpCredsErrorEl.style.display = "block";
        return;
      }
      if (!password) {
        rdpCredsErrorEl.textContent = "Password is required.";
        rdpCredsErrorEl.style.display = "block";
        return;
      }
      const creds = {
        username,
        password,
        domain: rdpCredsDomainInput.value.trim(),
        security: rdpCredsSecuritySelect.value || "any",
        ignoreCert: rdpCredsIgnoreCertInput.checked,
        remember: rdpCredsRememberInput.checked
      };
      cleanup();
      resolve(creds);
    };
    const onKey = (event) => {
      if (event.key === "Escape") { event.preventDefault(); onCancel(); }
    };
    rdpCredsCancelBtn.addEventListener("click", onCancel);
    rdpCredsSubmitBtn.addEventListener("click", onSubmit);
    rdpCredsModal.addEventListener("keydown", onKey);
  });
}

function promptForRdpIp(vmName, ips, statusEntry, message) {
  return new Promise((resolve) => {
    if (!rdpIpPickerModal) { resolve(null); return; }
    rdpIpPickerMsg.textContent = message || `Choose an IP to RDP into ${vmName}.`;
    rdpIpPickerListEl.innerHTML = "";
    const ipsObj = (statusEntry && statusEntry.ips) || {};
    ips.forEach((ip) => {
      const row = document.createElement("div");
      row.className = "ssh-ip-picker-row";
      const portStatus = (ipsObj[ip] && ipsObj[ip]["3389"]) || "unknown";
      row.innerHTML = `
        <span class="ssh-ip-addr">${escapeHtml(ip)}</span>
        <span class="ssh-ip-status" data-status="${escapeHtml(portStatus)}">${escapeHtml(portStatus)}</span>
      `;
      row.addEventListener("click", () => {
        cleanup();
        resolve(ip);
      });
      rdpIpPickerListEl.appendChild(row);
    });
    rdpIpPickerModal.classList.add("open");

    const cleanup = () => {
      rdpIpPickerModal.classList.remove("open");
      rdpIpPickerCancelBtn.removeEventListener("click", onCancel);
      rdpIpPickerModal.removeEventListener("keydown", onKey);
    };
    const onCancel = () => { cleanup(); resolve(null); };
    const onKey = (event) => {
      if (event.key === "Escape") { event.preventDefault(); onCancel(); }
    };
    rdpIpPickerCancelBtn.addEventListener("click", onCancel);
    rdpIpPickerModal.addEventListener("keydown", onKey);
  });
}

function teardownRdpSession(s) {
  const rdp = s.rdp;
  if (!rdp) return;
  if (rdp.resizeObserver) {
    try { rdp.resizeObserver.disconnect(); } catch (_e) { /* ignore */ }
  }
  if (rdp.captureTickHandle) {
    try { clearInterval(rdp.captureTickHandle); } catch (_e) { /* ignore */ }
  }
  if (rdp.client) {
    try { rdp.client.disconnect(); } catch (_e) { /* ignore */ }
  }
  if (rdp.keyboard) {
    try { rdp.keyboard.onkeydown = null; rdp.keyboard.onkeyup = null; } catch (_e) { /* ignore */ }
  }
  if (rdp.mouse) {
    try {
      rdp.mouse.onmousedown = null;
      rdp.mouse.onmouseup = null;
      rdp.mouse.onmousemove = null;
    } catch (_e) { /* ignore */ }
  }
  s.rdp = null;
}

async function openRdpFor(vmUuid) {
  if (!session.loggedIn) return;
  if (!featureFlags.isEnabled("rdpConsole")) return;
  if (!appConfig.rdp || !appConfig.rdp.enabled) {
    setStatus("RDP is disabled on this server (NRCC_RDP_ENABLED=false).");
    return;
  }

  const liveVm = getVmByUuid(vmUuid);
  const snap = liveVm || favStore.vmMeta[vmUuid];
  const vmName = (liveVm?.name) || (snap && snap.name) || vmUuid;
  const port = 3389;
  const ips = liveVm
    ? (Array.isArray(liveVm.ipAddresses) ? liveVm.ipAddresses : (liveVm.ipAddress ? [liveVm.ipAddress] : []))
    : (snap && snap.ipAddress ? [snap.ipAddress] : []);
  if (!ips.length) {
    setStatus(`No known IPs for ${vmName}; cannot RDP.`);
    return;
  }

  // IP resolution mirrors the SSH path but consults the rdp pillar
  // of the probe cache (port 3389 instead of 22).
  let host = null;
  let statusEntry = vmPortStatus.get(vmUuid);
  if (statusEntry && statusEntry.preferredIp && statusEntry.preferredIp.rdp) {
    host = statusEntry.preferredIp.rdp;
  } else {
    if (!statusEntry || (Date.now() - statusEntry.scannedAt) > 60_000) {
      setStatus(`Probing ${vmName} for RDP...`, { spinner: true });
      const probeVmInput = liveVm || { uuid: vmUuid, ipAddresses: ips };
      const fresh = await vmPortScanner.probeNow(probeVmInput);
      statusEntry = fresh || vmPortStatus.get(vmUuid) || null;
    }
    if (statusEntry && statusEntry.preferredIp && statusEntry.preferredIp.rdp) {
      host = statusEntry.preferredIp.rdp;
    } else {
      const message = ips.length === 1
        ? `RDP port 3389 was not detected on ${ips[0]}. Try anyway?`
        : `RDP port 3389 was not detected on any of ${vmName}'s IPs. Pick one to try anyway:`;
      const picked = await promptForRdpIp(vmName, ips, statusEntry, message);
      if (!picked) { setStatus("RDP cancelled."); return; }
      host = picked;
    }
  }
  if (!host) { setStatus("RDP cancelled."); return; }

  let creds = rdpCredsCache.get(vmUuid) || null;
  if (!creds) {
    creds = await promptForRdpCreds(vmUuid, host, port, null);
    if (!creds) { setStatus("RDP cancelled."); return; }
  }

  // Compute display dimensions from the actual screen-stage size so
  // guacd produces correctly-sized framebuffers from the first frame.
  // Falls back to /api/config defaults if the stage hasn't laid out
  // yet (rare; happens if the user hits "Open RDP" before showing
  // the console area).
  const stageRect = screenStageEl.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const defaults = appConfig.rdp || { defaultWidth: 1280, defaultHeight: 800, defaultDpi: 96 };
  const desiredWidth = Math.max(640, Math.floor((stageRect.width || defaults.defaultWidth) * dpr));
  const desiredHeight = Math.max(480, Math.floor((stageRect.height || defaults.defaultHeight) * dpr));
  const desiredDpi = Math.round((defaults.defaultDpi || 96) * dpr);

  setStatus(`Authorising RDP session to ${vmName} (${host})...`, { spinner: true });

  let startData;
  try {
    const resp = await fetch("/api/rdp/start", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vmUuid,
        host,
        port,
        username: creds.username,
        password: creds.password || "",
        domain: creds.domain || "",
        width: desiredWidth,
        height: desiredHeight,
        dpi: desiredDpi,
        security: creds.security || "any",
        ignoreCert: !!creds.ignoreCert
      })
    });
    startData = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(startData.error || `HTTP ${resp.status}`);
  } catch (err) {
    setStatus(`RDP start failed: ${err.message || err}`);
    if (creds && creds.remember) rdpCredsCache.delete(vmUuid);
    return;
  }
  if (creds.remember) rdpCredsCache.set(vmUuid, creds);

  let Guacamole;
  try {
    Guacamole = await loadGuacamoleModule();
  } catch (err) {
    setStatus(`Failed to load Guacamole bundle: ${err.message || err}`);
    return;
  }

  const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const screenEl = document.createElement("div");
  screenEl.className = "console-pane is-rdp";
  const wrap = document.createElement("div");
  wrap.className = "rdp-display-wrap";
  const displayHost = document.createElement("div");
  displayHost.className = "rdp-display";
  // Tabbable so keyboard focus actually routes through the
  // Guacamole.Keyboard listener.
  displayHost.tabIndex = 0;
  wrap.appendChild(displayHost);
  screenEl.appendChild(wrap);
  const overlay = document.createElement("div");
  overlay.className = "rdp-status-overlay";
  overlay.textContent = `Connecting to ${vmName} (${host}:${port})...`;
  screenEl.appendChild(overlay);
  screenStageEl.appendChild(screenEl);

  const wsScheme = location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${wsScheme}//${location.host}${startData.websocketUrl}`;
  // WebSocketTunnel wraps a WS in the Guacamole.Tunnel interface
  // and emits text-frame instructions; our server proxies those
  // straight to guacd after the handshake.
  const tunnel = new Guacamole.WebSocketTunnel(wsUrl);
  const client = new Guacamole.Client(tunnel);

  const display = client.getDisplay();
  const displayElement = display.getElement();
  displayHost.appendChild(displayElement);

  // Capture canvas for screenshot + recording. display.flatten()
  // returns a single composited canvas snapshot; we mirror it onto
  // a 2D canvas that the existing capture pipeline reads from. Same
  // approach as SSH (createSshCaptureCanvas), just reading from a
  // different source.
  const captureCanvas = document.createElement("canvas");
  const captureCtx = captureCanvas.getContext("2d", { alpha: false });
  function paintCapture() {
    try {
      const w = display.getWidth();
      const h = display.getHeight();
      if (!w || !h) return;
      if (captureCanvas.width !== w || captureCanvas.height !== h) {
        captureCanvas.width = w;
        captureCanvas.height = h;
      }
      const flat = display.flatten();
      if (flat) {
        captureCtx.fillStyle = "#000";
        captureCtx.fillRect(0, 0, w, h);
        captureCtx.drawImage(flat, 0, 0);
      }
    } catch (_e) { /* ignore */ }
  }
  // Repaint on every flush from the display (which fires after each
  // batch of drawing instructions). Idempotent if nothing changed.
  display.onflush = () => paintCapture();

  client.onstatechange = (state) => {
    // Guacamole client states:
    //   0 IDLE, 1 CONNECTING, 2 WAITING, 3 CONNECTED,
    //   4 DISCONNECTING, 5 DISCONNECTED
    if (state === 3) {
      overlay.hidden = true;
      setStatus(`RDP connected: ${vmName}`);
      // First capture frame so the screenshot button works
      // immediately after connect.
      paintCapture();
      // Resize to current pane size now we have a display.
      sendRdpSize();
    } else if (state === 5) {
      overlay.hidden = false;
      overlay.textContent = `RDP disconnected: ${vmName}`;
      setStatus(`RDP disconnected: ${vmName}`);
      logEvent("console.rdp.close", vmUuid, {});
    }
  };

  client.onerror = (status) => {
    const msg = status && status.message ? status.message : `code ${status?.code}`;
    overlay.hidden = false;
    overlay.textContent = `RDP error: ${msg}`;
    setStatus(`RDP error (${vmName}): ${msg}`);
  };

  // Server -> client clipboard relay. RDP guests that use Ctrl+C
  // produce a `clipboard` instruction; mirror it into the browser
  // clipboard so the user can paste outside the console.
  client.onclipboard = (stream, mimetype) => {
    if (!mimetype || !mimetype.startsWith("text/")) return;
    const reader = new Guacamole.StringReader(stream);
    let text = "";
    reader.ontext = (t) => { text += t; };
    reader.onend = () => {
      if (text && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => { /* user denied perm */ });
      }
    };
  };

  // Mouse + keyboard wiring. Guacamole ships its own helpers that
  // translate browser events into protocol instructions.
  const mouse = new Guacamole.Mouse(displayElement);
  const sendMouseState = (mouseState) => {
    // Display.scale() can shrink the display to fit the pane; the
    // mouse must report coordinates in display pixels, so we
    // unscale before forwarding.
    const scale = display.getScale() || 1;
    client.sendMouseState({
      x: mouseState.x / scale,
      y: mouseState.y / scale,
      left: mouseState.left,
      middle: mouseState.middle,
      right: mouseState.right,
      up: mouseState.up,
      down: mouseState.down
    });
  };
  mouse.onmousedown = sendMouseState;
  mouse.onmouseup = sendMouseState;
  mouse.onmousemove = sendMouseState;

  const keyboard = new Guacamole.Keyboard(displayElement);
  keyboard.onkeydown = (keysym) => { client.sendKeyEvent(1, keysym); };
  keyboard.onkeyup = (keysym) => { client.sendKeyEvent(0, keysym); };

  // Forward focus into the keyboard listener as soon as the user
  // clicks anywhere on the display, so RDP keystrokes work without
  // an extra Tab to focus.
  displayElement.addEventListener("mousedown", () => {
    try { displayHost.focus(); } catch (_e) { /* ignore */ }
  });

  // Resize: call client.sendSize when the screen pane changes size.
  // Guacamole lets us request a new framebuffer size mid-session if
  // the negotiated `resize-method` is "display-update" (which it is,
  // see buildRdpConnectValues on the server).
  let resizeObserver = null;
  let pendingResize = null;
  const sendRdpSize = () => {
    if (client.currentState === 5) return; // disconnected
    const rect = screenEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const w = Math.max(640, Math.floor(rect.width * (window.devicePixelRatio || 1)));
    const h = Math.max(480, Math.floor(rect.height * (window.devicePixelRatio || 1)));
    try { client.sendSize(w, h); } catch (_e) { /* ignore */ }
    // Also rescale the display to fit the pane (so a 1920x1080
    // framebuffer in a 1280x720 pane shrinks to fit).
    try {
      const ds = Math.min(rect.width / display.getWidth(), rect.height / display.getHeight());
      if (Number.isFinite(ds) && ds > 0) display.scale(ds);
    } catch (_e) { /* ignore */ }
  };
  const debouncedResize = () => {
    if (pendingResize) clearTimeout(pendingResize);
    pendingResize = setTimeout(sendRdpSize, 120);
  };
  resizeObserver = new ResizeObserver(debouncedResize);
  resizeObserver.observe(screenEl);

  // Fallback capture tick: even without a flush event we keep the
  // capture canvas warm at ~5 fps, so screenshots always reflect
  // recent frames. The recording pipeline pumps this faster.
  const captureTickHandle = setInterval(paintCapture, 200);

  try {
    // Optional connect data is appended to the WS URL as a query
    // string. We don't need to send anything (the server already
    // has our credentials), but Guacamole.Client.connect requires a
    // truthy argument on some versions.
    client.connect("");
  } catch (err) {
    setStatus(`RDP connect failed: ${err.message || err}`);
    return;
  }

  const newSession = {
    id: sessionId,
    vmUuid,
    vmName,
    kind: "rdp",
    rfb: null,
    screenEl,
    tabEl: null,
    keymap: lastUsedKeymap || DEFAULT_KEYMAP_ID,
    rdp: {
      client,
      tunnel,
      display,
      keyboard,
      mouse,
      host,
      port,
      username: creds.username,
      overlay,
      captureCanvas,
      captureTickHandle,
      resizeObserver,
      paintCapture
    }
  };
  const tabEl = createSessionTab(newSession);
  // Distinguish RDP tabs visually (purple) from VNC (blue) and SSH
  // (green) so the protocol is obvious at a glance.
  tabEl.classList.add("is-rdp");
  const tabLabelSpan = tabEl.querySelector("span:first-child");
  if (tabLabelSpan) tabLabelSpan.textContent = `rdp: ${vmName}`;
  newSession.tabEl = tabEl;
  consoleSessions.push(newSession);
  consoleTabsEl.appendChild(tabEl);
  setActiveSession(sessionId);

  setTimeout(() => { try { displayHost.focus(); } catch (_e) { /* ignore */ } }, 50);
  logEvent("console.rdp.open", vmUuid, { host, port });
}

// =====================================================================
// Activity logging (per-user opt-in -> POST /api/log)
// =====================================================================
//
// Called from feature code paths (paste, screenshot, recording start /
// stop, script copy, etc.) to record a single activity event. The
// server only writes when *both* (a) NRCC_LOGGING=true is set and
// (b) the request carries ?clientLogging=1 -- so disabling the
// per-user toggle in settings stops the server from receiving the
// log line at all.

function logEvent(type, vmUuid, details) {
  if (!type) return;
  if (!userPrefs.loggingEnabled || !appConfig.loggingAvailable) return;
  const body = { type };
  if (vmUuid) body.vmUuid = vmUuid;
  if (details && typeof details === "object") body.details = details;
  try {
    fetch("/api/log?clientLogging=1", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).catch(() => { /* fire-and-forget */ });
  } catch (_e) { /* ignore */ }
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

// =====================================================================
// SSH capture canvas (renderer-independent screenshot / recording)
// =====================================================================
//
// Reading pixels back from the xterm WebGL canvas turned out to be a
// fool's errand: there are multiple stacked canvases inside
// `.xterm-screen` (link layer, glyph layer, WebGL renderer canvas);
// the WebGL renderer uses damage-region updates so the framebuffer
// rarely contains a full screen at any instant; and the textureAtlas
// may even be exposed in DOM showing one zoomed glyph. To make
// screenshots and recordings actually work we maintain our OWN 2D
// canvas that we paint from `term.buffer.active`, regardless of
// what renderer xterm is using internally. The user still SEES the
// fast WebGL renderer; capture just reads from the parallel 2D
// canvas we keep in sync.

const SSH_CAPTURE_FONT_FAMILY = 'Menlo, Consolas, "DejaVu Sans Mono", monospace';
const SSH_CAPTURE_FONT_SIZE = 13;
const SSH_CAPTURE_LINE_HEIGHT = 17;

// Standard xterm 16-color palette + Linux-style brights. Indexes 16..255
// follow the xterm 6x6x6 + grayscale extended palette.
const SSH_ANSI_BASIC = [
  "#000000", "#cd3131", "#0dbc79", "#e5e510",
  "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5",
  "#666666", "#f14c4c", "#23d18b", "#f5f543",
  "#3b8eea", "#d670d6", "#29b8db", "#ffffff"
];
function sshAnsiPaletteToCss(idx, isFg) {
  if (idx == null || idx < 0) return isFg ? "#e5e5e5" : "#000000";
  if (idx < 16) return SSH_ANSI_BASIC[idx];
  if (idx < 232) {
    const i = idx - 16;
    const r = Math.floor(i / 36);
    const g = Math.floor((i % 36) / 6);
    const b = i % 6;
    const conv = (v) => (v === 0 ? 0 : v * 40 + 55);
    return `rgb(${conv(r)},${conv(g)},${conv(b)})`;
  }
  const v = (idx - 232) * 10 + 8;
  return `rgb(${v},${v},${v})`;
}
function sshRgbPackedToCss(packed) {
  return `rgb(${(packed >> 16) & 0xff},${(packed >> 8) & 0xff},${packed & 0xff})`;
}

// Build a self-painting capture canvas tied to a term + screen pane.
// Returns { canvas, paint, dispose, cellWidth, cellHeight }.
function createSshCaptureCanvas(term, screenEl) {
  const canvas = document.createElement("canvas");
  // Detached from DOM -- toBlob / captureStream both work on
  // unattached canvases. Keeping it offscreen avoids polluting the
  // screen pane and rules out sizing surprises from CSS.
  const ctx = canvas.getContext("2d", { alpha: false });

  // Measure the actual cell width on a probe canvas so the rendered
  // capture matches the terminal's column count. Using a fixed
  // SSH_CAPTURE_LINE_HEIGHT keeps line spacing stable across glyphs.
  let cellWidth = 8;
  let cellHeight = SSH_CAPTURE_LINE_HEIGHT;
  try {
    const probe = document.createElement("canvas").getContext("2d");
    probe.font = `${SSH_CAPTURE_FONT_SIZE}px ${SSH_CAPTURE_FONT_FAMILY}`;
    const w = probe.measureText("M").width;
    if (w > 0) cellWidth = Math.ceil(w);
  } catch (_e) { /* keep defaults */ }

  function paint() {
    if (!term || !term.buffer || !term.buffer.active) return;
    const cols = Math.max(2, term.cols || 80);
    const rows = Math.max(2, term.rows || 24);
    const dpr = window.devicePixelRatio || 1;
    const cssW = cols * cellWidth;
    const cssH = rows * cellHeight;
    const bufW = Math.max(2, Math.floor(cssW * dpr));
    const bufH = Math.max(2, Math.floor(cssH * dpr));
    if (canvas.width !== bufW || canvas.height !== bufH) {
      canvas.width = bufW;
      canvas.height = bufH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.textBaseline = "top";

    const buf = term.buffer.active;
    const baseLine = buf.viewportY || 0;
    const cursorVisible = (buf.cursorY >= 0 && buf.cursorX >= 0);
    const cursorAbsRow = baseLine + buf.cursorY;

    for (let y = 0; y < rows; y++) {
      const line = buf.getLine(baseLine + y);
      if (!line) continue;
      for (let x = 0; x < cols; x++) {
        const cell = line.getCell(x);
        if (!cell) continue;
        const chars = cell.getChars();
        // Background fill (only when not default).
        let bgColor = null;
        if (typeof cell.isBgRGB === "function" && cell.isBgRGB()) {
          bgColor = sshRgbPackedToCss(cell.getBgColor());
        } else if (typeof cell.isBgPalette === "function" && cell.isBgPalette()) {
          bgColor = sshAnsiPaletteToCss(cell.getBgColor(), false);
        }
        if (bgColor) {
          ctx.fillStyle = bgColor;
          ctx.fillRect(x * cellWidth, y * cellHeight, cellWidth, cellHeight);
        }
        // Inverse video: swap fg/bg.
        const inverse = (typeof cell.isInverse === "function" && cell.isInverse());
        // Foreground.
        let fgColor;
        if (typeof cell.isFgRGB === "function" && cell.isFgRGB()) {
          fgColor = sshRgbPackedToCss(cell.getFgColor());
        } else if (typeof cell.isFgPalette === "function" && cell.isFgPalette()) {
          fgColor = sshAnsiPaletteToCss(cell.getFgColor(), true);
        } else {
          fgColor = "#e5e5e5";
        }
        if (inverse) {
          const baseBg = bgColor || "#000000";
          ctx.fillStyle = fgColor;
          ctx.fillRect(x * cellWidth, y * cellHeight, cellWidth, cellHeight);
          fgColor = baseBg;
        }
        if (!chars) continue;
        const isBold = typeof cell.isBold === "function" && cell.isBold();
        const isItalic = typeof cell.isItalic === "function" && cell.isItalic();
        let fontStr = "";
        if (isItalic) fontStr += "italic ";
        if (isBold) fontStr += "bold ";
        fontStr += `${SSH_CAPTURE_FONT_SIZE}px ${SSH_CAPTURE_FONT_FAMILY}`;
        ctx.font = fontStr;
        ctx.fillStyle = fgColor;
        ctx.fillText(chars, x * cellWidth, y * cellHeight + 1);
      }
    }
    // Cursor: simple block over the cursor cell (non-blinking in
    // captures so users get a deterministic image).
    if (cursorVisible) {
      const cy = (cursorAbsRow - baseLine);
      if (cy >= 0 && cy < rows) {
        ctx.fillStyle = "rgba(229,229,229,0.55)";
        ctx.fillRect(buf.cursorX * cellWidth, cy * cellHeight, cellWidth, cellHeight);
      }
    }
  }

  // Hook xterm events that can change visible content. Each handler
  // returns a disposable; we collect them so dispose() can clean up.
  const disposables = [];
  const safeAdd = (fn) => { try { const d = fn(); if (d) disposables.push(d); } catch (_e) { /* ignore */ } };
  safeAdd(() => term.onWriteParsed(() => paint()));
  safeAdd(() => term.onCursorMove(() => paint()));
  safeAdd(() => term.onResize(() => paint()));
  safeAdd(() => term.onScroll(() => paint()));

  // Slow tick keeps captureStream emitting fresh frames during idle
  // periods (cursor blink) and ensures any race between the WebGL
  // refresh and our paint resolves quickly.
  const idleHandle = setInterval(() => paint(), 500);

  // First paint -- buffer may already have a prompt by the time the
  // user opens the tab from a remembered SSH host.
  setTimeout(paint, 0);

  return {
    canvas,
    paint,
    cellWidth,
    cellHeight,
    dispose() {
      try { clearInterval(idleHandle); } catch (_e) { /* ignore */ }
      for (const d of disposables) {
        try { d.dispose(); } catch (_e) { /* ignore */ }
      }
    }
  };
}

// Resolve the canvas the screenshot / recording pipeline reads from.
// SSH tabs use the dedicated 2D capture canvas (see
// createSshCaptureCanvas above); VNC tabs hand off to noVNC which
// appends a single canvas inside the screen pane.
function getSessionCanvas(s) {
  if (!s) return null;
  if (s.kind === "ssh" && s.ssh && s.ssh.capture) {
    try { s.ssh.capture.paint(); } catch (_e) { /* ignore */ }
    return s.ssh.capture.canvas;
  }
  if (s.kind === "rdp" && s.rdp && s.rdp.captureCanvas) {
    // Repaint right before reading so the screenshot reflects the
    // most recent display state. The recording pipeline keeps the
    // capture warm via its own tick (see startRecordingForSession).
    try { s.rdp.paintCapture(); } catch (_e) { /* ignore */ }
    return s.rdp.captureCanvas;
  }
  return s.screenEl.querySelector("canvas");
}

function activeConsoleCanvas() {
  const session = consoleSessions.find((s) => s.id === activeSessionId);
  if (!session) return { session: null, canvas: null };
  const canvas = getSessionCanvas(session);
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
  // Drop new screenshots into whatever subfolder the user was last
  // browsing for this VM, so capture-then-browse stays in the same
  // mental folder. Falls back to root when the browser is closed.
  const active = screenshotLibrary.getActive();
  const folder = (active && active.vmUuid === session.vmUuid)
    ? (active.folder || "")
    : "";
  const folderQuery = folder ? `?folder=${encodeURIComponent(folder)}` : "";
  try {
    const resp = await fetch(
      `/api/screenshots/${encodeURIComponent(session.vmUuid)}${folderQuery}`,
      {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pngBase64, width: canvas.width, height: canvas.height })
      }
    );
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      setStatus(`Save failed: ${data.error || resp.statusText}`);
      return;
    }
    let msg = `Screenshot saved: ${data.filename}`;
    if (folder) msg += ` (folder: ${folder})`;
    if (data.prunedCount > 0) {
      msg += ` (pruned ${data.prunedCount} older screenshot${data.prunedCount === 1 ? "" : "s"})`;
    }
    setStatus(msg);
    logEvent("console.screenshot", session.vmUuid, {
      filename: data.filename,
      folder: folder || null
    });
    // Refresh the modal in place so the user sees the new tile
    // appear without needing to hit Refresh manually.
    const activeAfter = screenshotLibrary.getActive();
    if (activeAfter && activeAfter.vmUuid === session.vmUuid) {
      screenshotLibrary.refresh();
    }
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

// =====================================================================
// Toast (transient confirmation messages, e.g. "Copied to clipboard")
// =====================================================================
let toastTimer = null;
function showToast(message, opts = {}) {
  toastEl.textContent = String(message || "");
  toastEl.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove("show");
    toastTimer = null;
  }, opts.durationMs || 2200);
}

// =====================================================================
// Folder navigator (shared helpers used by screenshots + recordings)
// =====================================================================
function renderBreadcrumbs(container, folder, onNavigate) {
  container.innerHTML = "";
  const crumbs = [{ name: "Root", path: "" }];
  if (folder) {
    const parts = folder.split("/");
    let acc = "";
    for (const seg of parts) {
      acc = acc ? `${acc}/${seg}` : seg;
      crumbs.push({ name: seg, path: acc });
    }
  }
  crumbs.forEach((c, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "browse-breadcrumb-sep";
      sep.textContent = "/";
      container.appendChild(sep);
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "browse-breadcrumb" + (i === crumbs.length - 1 ? " current" : "");
    btn.textContent = c.name;
    if (i < crumbs.length - 1) {
      btn.addEventListener("click", () => onNavigate(c.path));
    }
    container.appendChild(btn);
  });
}

function joinFolder(parent, child) {
  if (!parent) return child;
  if (!child) return parent;
  return `${parent}/${child}`;
}

function parentFolder(folder) {
  if (!folder) return "";
  const idx = folder.lastIndexOf("/");
  return idx < 0 ? "" : folder.slice(0, idx);
}

function isValidFolderName(name) {
  return /^[\w.\- ]{1,64}$/.test(String(name || ""));
}

// =====================================================================
// Finder-style asset library browser. Shared by screenshots and
// recordings; the only differences are the API base URL, the per-item
// URL builders, and whether the preview pane shows an <img> or <video>.
// Drag a tile in the middle list pane onto a folder row in the left
// tree pane to move the file (the server's assetMove route handles the
// rename + sidecar move). Right-click a folder row for rename/delete.
// =====================================================================
function cssEscapeAttr(s) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(s);
  return String(s).replace(/[^a-zA-Z0-9_\-]/g, (c) => "\\" + c);
}

// Toggles a body class while any .lib-modal (screenshot or recording
// library) is on screen so the bottom-right floating launchers (chat +
// script library) can hide themselves and stop covering the preview
// pane's Download / Delete buttons.
function syncLibraryBodyClass() {
  const anyOpen = document.querySelector(".modal-backdrop.open .lib-modal") !== null;
  document.body.classList.toggle("lib-modal-open", anyOpen);
}

function createLibraryBrowser(opts) {
  // opts:
  //   kind, apiBase, modal, titleEl, labelTitle, labelSingular, media,
  //   maxPerVm()  -> number, fileUrl(vmUuid, item, folder)  -> URL,
  //   downloadUrl(vmUuid, item, folder), deleteUrl(vmUuid, item, folder)
  const refs = {
    tree: opts.modal.querySelector("[data-lib-tree]"),
    list: opts.modal.querySelector("[data-lib-list]"),
    listPath: opts.modal.querySelector("[data-lib-list-path]"),
    listCount: opts.modal.querySelector("[data-lib-list-count]"),
    listEmpty: opts.modal.querySelector("[data-lib-list-empty]"),
    previewName: opts.modal.querySelector("[data-lib-preview-name]"),
    previewEmpty: opts.modal.querySelector("[data-lib-preview-empty]"),
    previewContent: opts.modal.querySelector("[data-lib-preview-content]"),
    previewStage: opts.modal.querySelector("[data-lib-preview-stage]"),
    previewMeta: opts.modal.querySelector("[data-lib-preview-meta]"),
    previewCaption: opts.modal.querySelector("[data-lib-preview-caption]"),
    previewCaptionSave: opts.modal.querySelector("[data-lib-preview-caption-save]"),
    previewCaptionFlash: opts.modal.querySelector("[data-lib-preview-caption-flash]"),
    previewDownload: opts.modal.querySelector("[data-lib-preview-download]"),
    previewDelete: opts.modal.querySelector("[data-lib-preview-delete]"),
    refresh: opts.modal.querySelector("[data-lib-refresh]"),
    close: opts.modal.querySelector("[data-lib-close]"),
    newFolder: opts.modal.querySelector("[data-lib-new-folder]")
  };

  let vmUuid = null;
  let vmName = null;
  let treeRoot = null;             // { name: "", children, fileCount }
  let expanded = new Set([""]);    // folder paths that are expanded ("" = root)
  let selectedFolder = "";
  let items = [];                  // items in selectedFolder
  let selectedFilename = null;
  let selectedItem = null;

  function isOpen() { return opts.modal.classList.contains("open"); }

  function show() { opts.modal.classList.add("open"); syncLibraryBodyClass(); }
  function hide() { opts.modal.classList.remove("open"); syncLibraryBodyClass(); }

  function open(uuid, name) {
    vmUuid = uuid;
    vmName = name;
    expanded = new Set([""]);
    selectedFolder = "";
    selectedFilename = null;
    selectedItem = null;
    if (opts.titleEl) opts.titleEl.textContent = `${opts.labelTitle} - ${name}`;
    show();
    clearPreview();
    refreshAll();
  }

  function close() {
    hide();
    vmUuid = null;
    vmName = null;
    treeRoot = null;
    items = [];
    selectedFolder = "";
    selectedFilename = null;
    selectedItem = null;
    refs.tree.innerHTML = "";
    refs.list.innerHTML = "";
    clearPreview();
  }

  async function refreshAll() {
    await refreshTree();
    await refreshList();
  }

  async function refreshTree() {
    if (!vmUuid) return;
    refs.tree.innerHTML = '<div class="lib-tree-row root"><span class="lib-tree-toggle placeholder"></span><span class="lib-tree-icon">.</span><span class="lib-tree-name">Loading...</span></div>';
    try {
      const resp = await fetch(`${opts.apiBase}/${encodeURIComponent(vmUuid)}/tree`, { credentials: "same-origin" });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        refs.tree.innerHTML = `<div class="lib-tree-row"><span class="lib-tree-name">Error: ${escapeHtml(data.error || resp.statusText)}</span></div>`;
        return;
      }
      treeRoot = data.tree || { name: "", children: [], fileCount: 0 };
      renderTree();
    } catch (err) {
      refs.tree.innerHTML = `<div class="lib-tree-row"><span class="lib-tree-name">Error: ${escapeHtml(err.message || err)}</span></div>`;
    }
  }

  function renderTree() {
    refs.tree.innerHTML = "";
    if (!treeRoot) return;
    const frag = document.createDocumentFragment();
    appendTreeRow(frag, treeRoot, "", 0, true);
    refs.tree.appendChild(frag);
  }

  function appendTreeRow(parentEl, node, parentPath, depth, isRoot) {
    const path = isRoot ? "" : (parentPath ? `${parentPath}/${node.name}` : node.name);
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    const isExpanded = expanded.has(path);
    const isSelected = path === selectedFolder;

    const row = document.createElement("div");
    row.className = "lib-tree-row" + (isSelected ? " selected" : "") + (isRoot ? " root" : "");
    row.style.paddingLeft = `${4 + depth * 14}px`;
    row.dataset.folder = path;
    row.innerHTML = `
      <span class="lib-tree-toggle${hasChildren ? "" : " placeholder"}" title="${hasChildren ? (isExpanded ? "Collapse" : "Expand") : ""}">${hasChildren ? (isExpanded ? "&#9660;" : "&#9654;") : "&#9654;"}</span>
      <span class="lib-tree-icon" aria-hidden="true">${isRoot ? "&#x1F5C2;" : (isExpanded ? "&#x1F4C2;" : "&#x1F4C1;")}</span>
      <span class="lib-tree-name">${escapeHtml(isRoot ? "Root" : node.name)}</span>
      ${node.fileCount > 0 ? `<span class="lib-tree-count">${node.fileCount}</span>` : ""}
    `;

    row.querySelector(".lib-tree-toggle").addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (!hasChildren) return;
      if (isExpanded) expanded.delete(path);
      else expanded.add(path);
      renderTree();
    });

    row.addEventListener("click", () => {
      if (hasChildren && !expanded.has(path)) expanded.add(path);
      selectFolder(path);
    });

    if (!isRoot) {
      row.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        showFolderContextMenu(ev, path, node.name);
      });
    }

    row.addEventListener("dragover", (ev) => {
      const dt = ev.dataTransfer;
      if (!dt) return;
      if (![...dt.types].includes("application/x-nrcc-asset")) return;
      ev.preventDefault();
      dt.dropEffect = "move";
      row.classList.add("drop-target");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
    row.addEventListener("drop", (ev) => {
      row.classList.remove("drop-target");
      const dt = ev.dataTransfer;
      if (!dt) return;
      const payload = dt.getData("application/x-nrcc-asset");
      if (!payload) return;
      ev.preventDefault();
      try {
        const data = JSON.parse(payload);
        if (data.kind !== opts.kind || data.vmUuid !== vmUuid) return;
        if (data.folder === path) return;
        moveFile(data.folder, data.filename, path);
      } catch (_e) { /* ignore */ }
    });

    parentEl.appendChild(row);

    if (hasChildren && isExpanded) {
      for (const child of node.children) {
        appendTreeRow(parentEl, child, path, depth + 1, false);
      }
    }
  }

  function selectFolder(path) {
    selectedFolder = path;
    selectedFilename = null;
    selectedItem = null;
    clearPreview();
    renderTree();
    refreshList();
  }

  async function refreshList() {
    if (!vmUuid) return;
    refs.listEmpty.hidden = true;
    refs.list.innerHTML = "";
    refs.listPath.textContent = selectedFolder ? `/${selectedFolder}` : "Root";
    refs.listCount.textContent = "Loading...";
    const url = `${opts.apiBase}/${encodeURIComponent(vmUuid)}${selectedFolder ? `?folder=${encodeURIComponent(selectedFolder)}` : ""}`;
    try {
      const resp = await fetch(url, { credentials: "same-origin" });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        refs.listCount.textContent = `Error: ${data.error || resp.statusText}`;
        return;
      }
      items = Array.isArray(data.items) ? data.items : [];
    } catch (err) {
      refs.listCount.textContent = `Error: ${err.message || err}`;
      return;
    }
    const cap = (typeof opts.maxPerVm === "function" && opts.maxPerVm()) ? ` (max ${opts.maxPerVm()} kept per VM)` : "";
    refs.listCount.textContent = items.length === 0
      ? "Empty"
      : `${items.length} ${opts.labelSingular}${items.length === 1 ? "" : "s"}${cap}`;
    if (items.length === 0) {
      refs.listEmpty.hidden = false;
    } else {
      for (const item of items) refs.list.appendChild(buildListTile(item));
    }
    if (selectedFilename) {
      const restored = items.find((it) => it.filename === selectedFilename);
      if (restored) selectItem(restored);
      else { selectedFilename = null; selectedItem = null; clearPreview(); }
    }
  }

  function buildListTile(item) {
    const tile = document.createElement("div");
    tile.className = "lib-list-tile" + (item.filename === selectedFilename ? " selected" : "");
    tile.draggable = true;
    tile.dataset.filename = item.filename;
    const thumbHtml = opts.media === "image"
      ? `<img loading="lazy" alt="" src="${opts.fileUrl(vmUuid, item, selectedFolder)}" />`
      : `<span aria-hidden="true">&#9658;</span>`;
    const sub = opts.media === "video"
      ? `${escapeHtml(Number.isFinite(item.durationMs) && item.durationMs > 0 ? fmtElapsed(item.durationMs) : "--:--")} . ${escapeHtml(fmtBytes(item.sizeBytes))}`
      : escapeHtml(fmtBytes(item.sizeBytes));
    tile.innerHTML = `
      <div class="lib-list-thumb">${thumbHtml}</div>
      <div class="lib-list-meta">
        <span class="lib-list-name" title="${escapeHtml(item.filename)}">${escapeHtml(fmtTimestamp(item.tsMs))}</span>
        <span class="lib-list-sub">${sub}</span>
        ${item.caption ? `<span class="lib-list-caption" title="${escapeHtml(item.caption)}">${escapeHtml(item.caption)}</span>` : ""}
      </div>
    `;
    tile.addEventListener("click", () => selectItem(item));
    tile.addEventListener("dragstart", (ev) => {
      const dt = ev.dataTransfer;
      if (!dt) return;
      const payload = JSON.stringify({ kind: opts.kind, vmUuid, folder: selectedFolder, filename: item.filename });
      dt.setData("application/x-nrcc-asset", payload);
      dt.effectAllowed = "move";
      tile.classList.add("dragging");
    });
    tile.addEventListener("dragend", () => tile.classList.remove("dragging"));
    return tile;
  }

  function selectItem(item) {
    selectedFilename = item.filename;
    selectedItem = item;
    refs.list.querySelectorAll(".lib-list-tile").forEach((t) => {
      t.classList.toggle("selected", t.dataset.filename === item.filename);
    });
    renderPreview(item);
  }

  function renderPreview(item) {
    refs.previewEmpty.hidden = true;
    refs.previewContent.hidden = false;
    refs.previewName.textContent = item.filename;
    refs.previewStage.innerHTML = "";
    const url = opts.fileUrl(vmUuid, item, selectedFolder);
    if (opts.media === "image") {
      const img = document.createElement("img");
      img.src = url;
      img.alt = item.filename;
      refs.previewStage.appendChild(img);
    } else {
      const video = document.createElement("video");
      video.src = url;
      video.controls = true;
      video.preload = "metadata";
      refs.previewStage.appendChild(video);
    }
    // Append a fullscreen toggle pinned to the stage. The native <video>
    // controls already include one, but having a dedicated button gives
    // <img> the same affordance and works regardless of media kind.
    const fsBtn = document.createElement("button");
    fsBtn.type = "button";
    fsBtn.className = "lib-preview-fullscreen";
    fsBtn.title = "Toggle fullscreen";
    fsBtn.setAttribute("aria-label", "Toggle fullscreen");
    fsBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5V2h3M9 2h3v3M12 9v3h-3M5 12H2v-3"/></svg>';
    fsBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (document.fullscreenElement === refs.previewStage) {
        document.exitFullscreen().catch(() => { /* ignore */ });
      } else if (refs.previewStage.requestFullscreen) {
        refs.previewStage.requestFullscreen().catch((e) => {
          setStatus(`Fullscreen failed: ${e.message || e}`);
        });
      }
    });
    refs.previewStage.appendChild(fsBtn);
    const metaParts = [];
    metaParts.push(escapeHtml(fmtTimestamp(item.tsMs)));
    metaParts.push(escapeHtml(fmtBytes(item.sizeBytes)));
    if (Number.isFinite(item.durationMs) && item.durationMs > 0) {
      metaParts.push(escapeHtml(`Duration: ${fmtElapsed(item.durationMs)}`));
    }
    if (item.author) metaParts.push(escapeHtml(`By: ${item.author}`));
    if (selectedFolder) metaParts.push(escapeHtml(`Folder: ${selectedFolder}`));
    refs.previewMeta.innerHTML = metaParts.map((p) => `<span>${p}</span>`).join("");
    refs.previewCaption.value = item.caption || "";
    refs.previewCaptionFlash.classList.remove("show");
    refs.previewDownload.href = opts.downloadUrl(vmUuid, item, selectedFolder);
    refs.previewDownload.setAttribute("download", item.filename);
  }

  function clearPreview() {
    refs.previewEmpty.hidden = false;
    refs.previewContent.hidden = true;
    refs.previewName.textContent = "";
    refs.previewStage.innerHTML = "";
    refs.previewMeta.innerHTML = "";
    refs.previewCaption.value = "";
  }

  async function moveFile(fromFolder, filename, toFolder) {
    try {
      const resp = await fetch(`${opts.apiBase}/${encodeURIComponent(vmUuid)}/move`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromFolder, toFolder, fromName: filename })
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        setStatus(`Move failed: ${err.error || resp.statusText}`);
        return;
      }
      setStatus(`Moved ${filename} to ${toFolder ? "/" + toFolder : "Root"}.`);
      if (fromFolder === selectedFolder && filename === selectedFilename) {
        selectedFilename = null;
        selectedItem = null;
        clearPreview();
      }
      await refreshTree();
      await refreshList();
    } catch (err) { setStatus(`Move failed: ${err.message || err}`); }
  }

  function showFolderContextMenu(ev, path, name) {
    showSimpleContextMenu(ev, name, [
      { label: "Rename...", onClick: async () => {
        const next = prompt("Rename folder", name);
        if (!next || next === name) return;
        if (!isValidFolderName(next)) { setStatus("Invalid folder name."); return; }
        const parent = parentFolder(path);
        try {
          const resp = await fetch(`${opts.apiBase}/${encodeURIComponent(vmUuid)}/move`, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fromFolder: parent, toFolder: parent, fromName: name, toName: next })
          });
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            setStatus(`Rename failed: ${err.error || resp.statusText}`);
            return;
          }
          const newPath = parent ? `${parent}/${next}` : next;
          if (expanded.has(path)) { expanded.delete(path); expanded.add(newPath); }
          if (selectedFolder === path) selectedFolder = newPath;
          await refreshTree();
          await refreshList();
        } catch (err) { setStatus(`Rename failed: ${err.message || err}`); }
      }},
      { label: "Delete (must be empty)", danger: true, onClick: async () => {
        if (!confirm(`Delete folder "${name}"? It must be empty.`)) return;
        try {
          const resp = await fetch(`${opts.apiBase}/${encodeURIComponent(vmUuid)}/folders`, {
            method: "DELETE",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path })
          });
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            setStatus(`Delete failed: ${err.error || resp.statusText}`);
            return;
          }
          if (selectedFolder === path) selectedFolder = parentFolder(path);
          expanded.delete(path);
          await refreshTree();
          await refreshList();
        } catch (err) { setStatus(`Delete failed: ${err.message || err}`); }
      }}
    ]);
  }

  // Modal-level wiring (registered once per instance)
  refs.refresh.addEventListener("click", () => refreshAll());
  refs.close.addEventListener("click", close);
  opts.modal.addEventListener("click", (event) => {
    if (event.target === opts.modal) close();
  });
  refs.newFolder.addEventListener("click", async () => {
    if (!vmUuid) return;
    const name = prompt("New subfolder name (will be created inside the selected folder)");
    if (!name) return;
    if (!isValidFolderName(name)) { setStatus("Invalid folder name."); return; }
    const target = joinFolder(selectedFolder, name);
    try {
      const resp = await fetch(`${opts.apiBase}/${encodeURIComponent(vmUuid)}/folders`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: target })
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        setStatus(`Create failed: ${err.error || resp.statusText}`);
        return;
      }
      expanded.add(selectedFolder);
      await refreshTree();
    } catch (err) { setStatus(`Create failed: ${err.message || err}`); }
  });
  refs.previewCaptionSave.addEventListener("click", async () => {
    if (!vmUuid || !selectedItem) return;
    try {
      const resp = await fetch(`${opts.apiBase}/${encodeURIComponent(vmUuid)}/meta`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder: selectedFolder,
          filename: selectedItem.filename,
          caption: refs.previewCaption.value
        })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) { setStatus(`Save failed: ${data.error || resp.statusText}`); return; }
      selectedItem.caption = data.caption || "";
      const inList = items.find((it) => it.filename === selectedItem.filename);
      if (inList) inList.caption = selectedItem.caption;
      const tile = refs.list.querySelector(`.lib-list-tile[data-filename="${cssEscapeAttr(selectedItem.filename)}"]`);
      if (tile) {
        let captionEl = tile.querySelector(".lib-list-caption");
        if (selectedItem.caption) {
          if (!captionEl) {
            captionEl = document.createElement("span");
            captionEl.className = "lib-list-caption";
            tile.querySelector(".lib-list-meta").appendChild(captionEl);
          }
          captionEl.textContent = selectedItem.caption;
          captionEl.title = selectedItem.caption;
        } else if (captionEl) {
          captionEl.remove();
        }
      }
      refs.previewCaptionFlash.classList.add("show");
      setTimeout(() => refs.previewCaptionFlash.classList.remove("show"), 1500);
    } catch (err) { setStatus(`Save failed: ${err.message || err}`); }
  });
  refs.previewDelete.addEventListener("click", async () => {
    if (!vmUuid || !selectedItem) return;
    if (!confirm(`Delete ${selectedItem.filename}?`)) return;
    try {
      const resp = await fetch(opts.deleteUrl(vmUuid, selectedItem, selectedFolder), {
        method: "DELETE",
        credentials: "same-origin"
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        setStatus(`Delete failed: ${err.error || resp.statusText}`);
        return;
      }
      const filename = selectedItem.filename;
      selectedFilename = null;
      selectedItem = null;
      clearPreview();
      await refreshTree();
      await refreshList();
      setStatus(`Deleted ${filename}.`);
    } catch (err) { setStatus(`Delete failed: ${err.message || err}`); }
  });

  return {
    open,
    close,
    refresh: refreshAll,
    isOpen,
    getActive() { return vmUuid ? { vmUuid, vmName, folder: selectedFolder } : null; }
  };
}

// ---- Library instances --------------------------------------------------
const screenshotLibrary = createLibraryBrowser({
  kind: "screenshot",
  apiBase: "/api/screenshots",
  modal: screenshotBrowseModal,
  titleEl: screenshotBrowseTitle,
  labelTitle: "Screenshots",
  labelSingular: "screenshot",
  media: "image",
  maxPerVm: () => appConfig.screenshotMaxPerVm,
  fileUrl: (uuid, item, folder) =>
    `/api/screenshots/${encodeURIComponent(uuid)}/${encodeURIComponent(item.filename)}${folder ? `?folder=${encodeURIComponent(folder)}` : ""}`,
  downloadUrl: (uuid, item, folder) =>
    `/api/screenshots/${encodeURIComponent(uuid)}/${encodeURIComponent(item.filename)}?download=1${folder ? `&folder=${encodeURIComponent(folder)}` : ""}`,
  deleteUrl: (uuid, item, folder) =>
    `/api/screenshots/${encodeURIComponent(uuid)}/${encodeURIComponent(item.filename)}${folder ? `?folder=${encodeURIComponent(folder)}` : ""}`
});

function openScreenshotBrowser() {
  const session = consoleSessions.find((s) => s.id === activeSessionId);
  if (!session) {
    setStatus("Open a console first to browse screenshots.");
    return;
  }
  screenshotLibrary.open(session.vmUuid, session.vmName);
}

screenshotBtn.addEventListener("click", () => { captureActiveScreenshot(); });
screenshotBrowseBtn.addEventListener("click", openScreenshotBrowser);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && screenshotLibrary.isOpen()) screenshotLibrary.close();
});

// =====================================================================
// Recording lifecycle (per-session). State lives on each consoleSessions
// entry as `recording = { recorder, recordingId, startedAt, bytesUploaded,
// pendingChunks, uploadInFlight, timerHandle }` so multiple VMs can
// record in parallel without interfering.
// =====================================================================
function pickRecordingMimeType() {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm"
  ];
  for (const mt of candidates) {
    try {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mt)) return mt;
    } catch (_e) { /* ignore */ }
  }
  return "";
}

function fmtElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60).toString().padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function refreshRecordButtonForActiveSession() {
  const active = consoleSessions.find((s) => s.id === activeSessionId);
  if (!active || !active.recording) {
    recordBtn.classList.remove("is-recording");
    recordBtn.querySelector(".record-btn-label").textContent = "Record";
    recordBtnTimer.hidden = true;
    return;
  }
  recordBtn.classList.add("is-recording");
  recordBtn.querySelector(".record-btn-label").textContent = "Stop";
  recordBtnTimer.hidden = false;
  recordBtnTimer.textContent = fmtElapsed(Date.now() - active.recording.startedAt);
}

function refreshTabRecordingDot(session) {
  if (!session?.tabEl) return;
  const labelSpan = session.tabEl.querySelector("span:first-child");
  if (!labelSpan) return;
  const existing = labelSpan.querySelector(".tab-rec-dot");
  if (session.recording && !existing) {
    const dot = document.createElement("span");
    dot.className = "tab-rec-dot";
    labelSpan.prepend(dot);
  } else if (!session.recording && existing) {
    existing.remove();
  }
}

async function startRecordingForSession(session) {
  if (!session) return;
  if (session.recording) return;
  if (typeof MediaRecorder === "undefined") {
    setStatus("MediaRecorder is not supported in this browser.");
    return;
  }
  const canvas = getSessionCanvas(session);
  if (!canvas) { setStatus(`No canvas to record for ${session.vmName}.`); return; }
  const mimeType = pickRecordingMimeType();
  if (!mimeType) { setStatus("Browser does not support WebM recording."); return; }
  const fps = appConfig.recording.fps || 10;

  let stream;
  try { stream = canvas.captureStream(fps); }
  catch (err) { setStatus(`captureStream failed: ${err.message || err}`); return; }

  const recActive = recordingLibrary.getActive();
  const folder = (recActive && recActive.vmUuid === session.vmUuid)
    ? (recActive.folder || "")
    : "";

  let startResp;
  try {
    startResp = await fetch(`/api/recordings/${encodeURIComponent(session.vmUuid)}/start`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder, fps, width: canvas.width, height: canvas.height, mimeType })
    });
  } catch (err) {
    setStatus(`Could not start recording: ${err.message || err}`);
    try { stream.getTracks().forEach((t) => t.stop()); } catch (_e) { /* ignore */ }
    return;
  }
  const startData = await startResp.json().catch(() => ({}));
  if (!startResp.ok) {
    setStatus(`Could not start recording: ${startData.error || startResp.statusText}`);
    try { stream.getTracks().forEach((t) => t.stop()); } catch (_e) { /* ignore */ }
    return;
  }

  let recorder;
  try {
    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: appConfig.recording.bitrate || 600_000
    });
  } catch (err) {
    setStatus(`Recorder init failed: ${err.message || err}`);
    try { stream.getTracks().forEach((t) => t.stop()); } catch (_e) { /* ignore */ }
    try {
      await fetch(`/api/recordings/${encodeURIComponent(session.vmUuid)}/abort`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordingId: startData.recordingId })
      });
    } catch (_e) { /* ignore */ }
    return;
  }

  const state = {
    recorder,
    recordingId: startData.recordingId,
    startedAt: Date.now(),
    folder,
    fps,
    mimeType,
    width: canvas.width,
    height: canvas.height,
    stream,
    pendingChunks: [],
    uploadInFlight: false,
    failed: false,
    bytesUploaded: 0,
    timerHandle: null,
    aborted: false,
    finishing: false
  };
  session.recording = state;

  state.timerHandle = setInterval(() => {
    if (consoleSessions.find((s) => s.id === activeSessionId) === session) {
      recordBtnTimer.textContent = fmtElapsed(Date.now() - state.startedAt);
    }
  }, 500);

  // SSH-only: xterm only repaints when the terminal receives data,
  // so a quiet shell would produce a captureStream that emits
  // duplicate (already-decoded) frames or nothing at all. Force a
  // periodic redraw at the recording fps so the WebGL canvas keeps
  // producing fresh frames for the encoder. The tick is cheap
  // (xterm short-circuits when nothing changed) and gets cleared
  // alongside `timerHandle` in finalizeRecording.
  if (session.kind === "ssh" && session.ssh && session.ssh.capture) {
    // Drive the capture canvas at the recording frame rate so
    // canvas.captureStream always has a fresh frame to present, even
    // when the shell is idle and not producing data.
    const tickMs = Math.max(50, Math.floor(1000 / Math.max(1, fps)));
    state.refreshTickHandle = setInterval(() => {
      try { session.ssh.capture.paint(); } catch (_e) { /* ignore */ }
    }, tickMs);
  }
  // RDP: same rationale -- the Guacamole display only repaints on
  // protocol updates, so a static guest desktop would produce a
  // stale captureStream. Drive the capture canvas at the recording
  // frame rate too.
  if (session.kind === "rdp" && session.rdp && session.rdp.paintCapture) {
    const tickMs = Math.max(50, Math.floor(1000 / Math.max(1, fps)));
    state.refreshTickHandle = setInterval(() => {
      try { session.rdp.paintCapture(); } catch (_e) { /* ignore */ }
    }, tickMs);
  }

  recorder.ondataavailable = (ev) => {
    if (!ev.data || ev.data.size === 0) return;
    state.pendingChunks.push(ev.data);
    drainRecordingChunks(session);
  };
  recorder.onerror = (ev) => {
    setStatus(`Recorder error: ${ev?.error?.message || "unknown"}`);
    state.failed = true;
    stopRecordingForSession(session, { reason: "error" });
  };
  recorder.onstop = () => {
    drainRecordingChunks(session, { andFinish: true });
  };

  try { recorder.start(2000); }
  catch (err) {
    setStatus(`Recorder start failed: ${err.message || err}`);
    session.recording = null;
    try { stream.getTracks().forEach((t) => t.stop()); } catch (_e) { /* ignore */ }
    return;
  }

  refreshTabRecordingDot(session);
  refreshRecordButtonForActiveSession();
  setStatus(`Recording ${session.vmName} (${mimeType}, ${fps} fps).`);
  logEvent("console.recording.start", session.vmUuid, {
    recordingId: state.recordingId,
    mimeType,
    fps,
    folder: folder || null
  });
}

async function drainRecordingChunks(session, opts = {}) {
  const state = session?.recording;
  if (!state) return;
  if (state.uploadInFlight) {
    if (opts.andFinish) state.finishOnDrain = true;
    return;
  }
  while (state.pendingChunks.length > 0) {
    state.uploadInFlight = true;
    const blob = state.pendingChunks.shift();
    try {
      const buf = await blob.arrayBuffer();
      const resp = await fetch(
        `/api/recordings/${encodeURIComponent(session.vmUuid)}/chunk?recordingId=${encodeURIComponent(state.recordingId)}`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/octet-stream" },
          body: buf
        }
      );
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        setStatus(`Recording upload failed: ${err.error || resp.statusText}`);
        state.failed = true;
        try { state.recorder.stop(); } catch (_e) { /* ignore */ }
        state.uploadInFlight = false;
        return;
      }
      const data = await resp.json().catch(() => ({}));
      if (typeof data.bytesWritten === "number") state.bytesUploaded = data.bytesWritten;
    } catch (err) {
      setStatus(`Recording upload failed: ${err.message || err}`);
      state.failed = true;
      try { state.recorder.stop(); } catch (_e) { /* ignore */ }
      state.uploadInFlight = false;
      return;
    }
    state.uploadInFlight = false;
  }
  if (opts.andFinish || state.finishOnDrain) {
    await finalizeRecording(session);
  }
}

async function finalizeRecording(session) {
  const state = session?.recording;
  if (!state || state.finishing) return;
  state.finishing = true;
  try { state.stream.getTracks().forEach((t) => t.stop()); } catch (_e) { /* ignore */ }
  if (state.timerHandle) { clearInterval(state.timerHandle); state.timerHandle = null; }
  if (state.refreshTickHandle) { clearInterval(state.refreshTickHandle); state.refreshTickHandle = null; }
  if (state.aborted || state.failed) {
    try {
      await fetch(`/api/recordings/${encodeURIComponent(session.vmUuid)}/abort`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordingId: state.recordingId })
      });
    } catch (_e) { /* ignore */ }
  } else {
    try {
      const resp = await fetch(`/api/recordings/${encodeURIComponent(session.vmUuid)}/finish`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordingId: state.recordingId,
          durationMs: Date.now() - state.startedAt
        })
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok) {
        let msg = `Recording saved: ${data.filename} (${fmtBytes(data.sizeBytes || 0)}, ${fmtElapsed(data.durationMs || 0)})`;
        if (data.prunedCount > 0) msg += ` (pruned ${data.prunedCount} older)`;
        setStatus(msg);
        logEvent("console.recording.stop", session.vmUuid, {
          recordingId: state.recordingId,
          filename: data.filename,
          sizeBytes: data.sizeBytes || 0,
          durationMs: data.durationMs || 0
        });
        const recActiveAfter = recordingLibrary.getActive();
        if (recActiveAfter && recActiveAfter.vmUuid === session.vmUuid) {
          recordingLibrary.refresh();
        }
      } else {
        setStatus(`Save failed: ${data.error || resp.statusText}`);
      }
    } catch (err) {
      setStatus(`Save failed: ${err.message || err}`);
    }
  }
  session.recording = null;
  refreshTabRecordingDot(session);
  refreshRecordButtonForActiveSession();
}

function stopRecordingForSession(session, opts = {}) {
  const state = session?.recording;
  if (!state) return;
  if (opts.reason === "session-closed" || opts.reason === "logout") state.aborted = true;
  try { state.recorder.stop(); }
  catch (_e) {
    state.aborted = true;
    finalizeRecording(session);
  }
}

function toggleRecordingForActive() {
  const active = consoleSessions.find((s) => s.id === activeSessionId);
  if (!active) { setStatus("Open a console first to record."); return; }
  if (active.recording) stopRecordingForSession(active);
  else startRecordingForSession(active);
}

recordBtn.addEventListener("click", toggleRecordingForActive);

// =====================================================================
// Recording library (Finder-style 3-pane browser, shared factory above)
// =====================================================================
const recordingLibrary = createLibraryBrowser({
  kind: "recording",
  apiBase: "/api/recordings",
  modal: recordingBrowseModal,
  titleEl: recordingBrowseTitle,
  labelTitle: "Recordings",
  labelSingular: "recording",
  media: "video",
  maxPerVm: () => appConfig.recording && appConfig.recording.maxPerVm,
  fileUrl: (uuid, item, folder) =>
    `/api/recordings/${encodeURIComponent(uuid)}/file?filename=${encodeURIComponent(item.filename)}${folder ? `&folder=${encodeURIComponent(folder)}` : ""}`,
  downloadUrl: (uuid, item, folder) =>
    `/api/recordings/${encodeURIComponent(uuid)}/file?filename=${encodeURIComponent(item.filename)}&download=1${folder ? `&folder=${encodeURIComponent(folder)}` : ""}`,
  deleteUrl: (uuid, item, folder) =>
    `/api/recordings/${encodeURIComponent(uuid)}/file?filename=${encodeURIComponent(item.filename)}${folder ? `&folder=${encodeURIComponent(folder)}` : ""}`
});

function openRecordingBrowser() {
  const session = consoleSessions.find((s) => s.id === activeSessionId);
  if (!session) {
    setStatus("Open a console first to browse recordings.");
    return;
  }
  recordingLibrary.open(session.vmUuid, session.vmName);
}

recordBrowseBtn.addEventListener("click", openRecordingBrowser);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && recordingLibrary.isOpen()) recordingLibrary.close();
});

// =====================================================================
// Global script library
// =====================================================================
let scriptLibState = {
  folder: "",
  folders: [],
  items: [],
  open: false
};

async function refreshScriptLibrary(folder = scriptLibState.folder) {
  scriptLibState.folder = folder;
  scriptGrid.innerHTML = "";
  scriptEmpty.hidden = true;
  scriptCount.textContent = "Loading...";
  renderBreadcrumbs(scriptBreadcrumbs, folder, (target) => refreshScriptLibrary(target));
  let folders = [], items = [];
  try {
    const url = folder ? `/api/scripts?folder=${encodeURIComponent(folder)}` : "/api/scripts";
    const resp = await fetch(url, { credentials: "same-origin" });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      scriptCount.textContent = `Error: ${data.error || resp.statusText}`;
      return;
    }
    folders = Array.isArray(data.folders) ? data.folders : [];
    items = Array.isArray(data.items) ? data.items : [];
  } catch (err) {
    scriptCount.textContent = `Error: ${err.message || err}`;
    return;
  }
  scriptLibState.folders = folders;
  scriptLibState.items = items;
  if (folders.length === 0 && items.length === 0) {
    scriptEmpty.hidden = false;
    scriptCount.textContent = "";
  } else {
    scriptCount.textContent = `${items.length} script${items.length === 1 ? "" : "s"} . ${folders.length} subfolder${folders.length === 1 ? "" : "s"}`;
  }
  renderScriptFolderPane();

  // Folder tiles first.
  for (const f of folders) {
    const tile = document.createElement("div");
    tile.className = "script-tile is-folder";
    tile.innerHTML = `
      <span class="script-tile-icon" aria-hidden="true">[F]</span>
      <span class="script-tile-label">${escapeHtml(f.name)}</span>
      <span class="script-tile-meta">Folder</span>
    `;
    tile.addEventListener("click", () => refreshScriptLibrary(joinFolder(folder, f.name)));
    tile.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      // Stop the global "hide-on-contextmenu" handler (registered on
      // document) from immediately tearing down the menu we're about
      // to render. The favorites context menu does the same dance.
      ev.stopPropagation();
      showScriptFolderContextMenu(ev, folder, f);
    });
    scriptGrid.appendChild(tile);
  }
  // Script tiles.
  for (const item of items) {
    const tile = document.createElement("div");
    tile.className = "script-tile";
    tile.innerHTML = `
      <span class="script-tile-icon" aria-hidden="true">${escapeHtml("</>")}</span>
      <span class="script-tile-label" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span>
      <span class="script-tile-desc">${escapeHtml(item.description || "")}</span>
      <span class="script-tile-meta">${escapeHtml(item.language || "text")} . ${escapeHtml(fmtBytes(item.sizeBytes))}</span>
    `;
    tile.title = "Left-click: copy to clipboard. Right-click: edit / rename / delete.";
    tile.addEventListener("click", () => copyScriptToClipboard(folder, item));
    tile.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      showScriptItemContextMenu(ev, folder, item);
    });
    scriptGrid.appendChild(tile);
  }
}

function renderScriptFolderPane() {
  scriptFolderPane.innerHTML = "";
  const header = document.createElement("div");
  header.className = "script-folder-pane-header";
  header.innerHTML = `<span>Folders</span>`;
  scriptFolderPane.appendChild(header);

  const rootRow = document.createElement("div");
  rootRow.className = "script-folder-row root" + (scriptLibState.folder === "" ? " active" : "");
  rootRow.innerHTML = `<span class="ico" aria-hidden="true">/</span><span>Root</span>`;
  rootRow.addEventListener("click", () => refreshScriptLibrary(""));
  scriptFolderPane.appendChild(rootRow);

  // Show ancestor breadcrumb folders + immediate children of the
  // current folder. This stays simple without a full lazy tree.
  if (scriptLibState.folder) {
    const parts = scriptLibState.folder.split("/");
    let acc = "";
    parts.forEach((seg, idx) => {
      acc = acc ? `${acc}/${seg}` : seg;
      const row = document.createElement("div");
      row.className = "script-folder-row" + (acc === scriptLibState.folder ? " active" : "");
      row.innerHTML = `${"<span class='indent'></span>".repeat(idx + 1)}<span class="ico" aria-hidden="true">[F]</span><span>${escapeHtml(seg)}</span>`;
      row.addEventListener("click", () => refreshScriptLibrary(acc));
      scriptFolderPane.appendChild(row);
    });
  }
  for (const f of scriptLibState.folders) {
    const row = document.createElement("div");
    const depth = scriptLibState.folder ? scriptLibState.folder.split("/").length + 1 : 1;
    row.className = "script-folder-row";
    row.innerHTML = `${"<span class='indent'></span>".repeat(depth)}<span class="ico" aria-hidden="true">[F]</span><span>${escapeHtml(f.name)}</span>`;
    row.addEventListener("click", () => refreshScriptLibrary(joinFolder(scriptLibState.folder, f.name)));
    scriptFolderPane.appendChild(row);
  }
}

async function copyScriptToClipboard(folder, item) {
  let body;
  try {
    const url = `/api/scripts/file?filename=${encodeURIComponent(item.filename)}${folder ? `&folder=${encodeURIComponent(folder)}` : ""}`;
    const resp = await fetch(url, { credentials: "same-origin" });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      setStatus(`Could not load script: ${data.error || resp.statusText}`);
      return;
    }
    body = String(data.body || "");
  } catch (err) {
    setStatus(`Could not load script: ${err.message || err}`);
    return;
  }
  let copied = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(body);
      copied = true;
    }
  } catch (_e) { /* fall through to legacy path */ }
  if (!copied) {
    // Legacy fallback for non-secure-context HTTP single-user mode,
    // where the async Clipboard API is unavailable.
    try {
      const ta = document.createElement("textarea");
      ta.value = body;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      copied = document.execCommand("copy");
      document.body.removeChild(ta);
    } catch (_e) { /* ignore */ }
  }
  if (copied) {
    showToast(`Copied "${item.label}" to clipboard`);
    logEvent("console.script.copy", null, {
      folder: folder || null,
      filename: item.filename,
      label: item.label
    });
  } else {
    setStatus(`Could not copy to clipboard. Use Edit -> Copy from the editor instead.`);
  }
}

function showScriptItemContextMenu(ev, folder, item) {
  showSimpleContextMenu(ev, item.label, [
    { label: "Copy to clipboard", onClick: () => copyScriptToClipboard(folder, item) },
    { label: "Edit", onClick: () => openScriptEditor({ mode: "edit", folder, item }) },
    { label: "Rename", onClick: async () => {
      const next = prompt("New label", item.label);
      if (!next || next === item.label) return;
      try {
        const resp = await fetch(`/api/scripts/file`, {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder, filename: item.filename, label: next })
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          setStatus(`Rename failed: ${err.error || resp.statusText}`);
          return;
        }
        refreshScriptLibrary(folder);
      } catch (err) { setStatus(`Rename failed: ${err.message || err}`); }
    }},
    { label: "Move to root", disabled: !folder, onClick: () => moveScript(folder, item.filename, "", item.filename) },
    { label: "Delete", danger: true, onClick: async () => {
      if (!confirm(`Delete "${item.label}"?`)) return;
      try {
        const resp = await fetch(`/api/scripts/file?filename=${encodeURIComponent(item.filename)}${folder ? `&folder=${encodeURIComponent(folder)}` : ""}`, {
          method: "DELETE",
          credentials: "same-origin"
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          setStatus(`Delete failed: ${err.error || resp.statusText}`);
          return;
        }
        refreshScriptLibrary(folder);
      } catch (err) { setStatus(`Delete failed: ${err.message || err}`); }
    }}
  ]);
}

function showScriptFolderContextMenu(ev, parentFolderRel, folder) {
  showSimpleContextMenu(ev, folder.name, [
    { label: "Open", onClick: () => refreshScriptLibrary(joinFolder(parentFolderRel, folder.name)) },
    { label: "Rename", onClick: async () => {
      const next = prompt("Rename folder", folder.name);
      if (!next || next === folder.name) return;
      if (!isValidFolderName(next)) { setStatus("Invalid folder name."); return; }
      try {
        const resp = await fetch(`/api/scripts/move`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fromFolder: parentFolderRel, toFolder: parentFolderRel, fromName: folder.name, toName: next })
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          setStatus(`Rename failed: ${err.error || resp.statusText}`);
          return;
        }
        refreshScriptLibrary(parentFolderRel);
      } catch (err) { setStatus(`Rename failed: ${err.message || err}`); }
    }},
    { label: "Delete (must be empty)", danger: true, onClick: async () => {
      if (!confirm(`Delete folder "${folder.name}"?`)) return;
      try {
        const resp = await fetch(`/api/scripts/folders`, {
          method: "DELETE",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: joinFolder(parentFolderRel, folder.name) })
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          setStatus(`Delete failed: ${err.error || resp.statusText}`);
          return;
        }
        refreshScriptLibrary(parentFolderRel);
      } catch (err) { setStatus(`Delete failed: ${err.message || err}`); }
    }}
  ]);
}

async function moveScript(fromFolder, fromName, toFolder, toName) {
  try {
    const resp = await fetch(`/api/scripts/move`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromFolder, toFolder, fromName, toName })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      setStatus(`Move failed: ${err.error || resp.statusText}`);
      return;
    }
    refreshScriptLibrary(scriptLibState.folder);
  } catch (err) { setStatus(`Move failed: ${err.message || err}`); }
}

// Reuse the existing #ctxMenu node already in the page; render a
// lightweight, ad-hoc menu without going through the favorites code.
function showSimpleContextMenu(ev, header, items) {
  ctxMenu.innerHTML = "";
  if (header) {
    const h = document.createElement("div");
    h.className = "ctx-menu-header";
    h.textContent = header;
    ctxMenu.appendChild(h);
  }
  for (const it of items) {
    const row = document.createElement("div");
    row.className = "ctx-menu-item" + (it.disabled ? " disabled" : "") + (it.danger ? " power-off" : "");
    row.innerHTML = `<span class="ctx-icon"></span><span>${escapeHtml(it.label)}</span>`;
    if (!it.disabled) {
      row.addEventListener("click", () => {
        ctxMenu.classList.remove("open");
        try { it.onClick(); } catch (_e) { /* ignore */ }
      });
    }
    ctxMenu.appendChild(row);
  }
  ctxMenu.style.left = `${ev.clientX}px`;
  ctxMenu.style.top = `${ev.clientY}px`;
  ctxMenu.classList.add("open");
}

function openScriptLibrary() {
  scriptLibState.open = true;
  scriptLibraryModal.hidden = false;
  scriptLauncher.classList.add("is-open");
  refreshScriptLibrary(scriptLibState.folder);
}
function closeScriptLibrary() {
  scriptLibState.open = false;
  scriptLibraryModal.hidden = true;
  scriptLauncher.classList.remove("is-open");
}
function toggleScriptLibrary() {
  if (scriptLibState.open) closeScriptLibrary();
  else openScriptLibrary();
}

scriptLauncher.addEventListener("click", toggleScriptLibrary);
scriptCloseBtn.addEventListener("click", closeScriptLibrary);
scriptRefreshBtn.addEventListener("click", () => refreshScriptLibrary(scriptLibState.folder));
scriptNewFolderBtn.addEventListener("click", async () => {
  const name = prompt("New subfolder name");
  if (!name) return;
  if (!isValidFolderName(name)) { setStatus("Invalid folder name."); return; }
  const target = joinFolder(scriptLibState.folder, name);
  try {
    const resp = await fetch(`/api/scripts/folders`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: target })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      setStatus(`Create failed: ${err.error || resp.statusText}`);
      return;
    }
    refreshScriptLibrary(scriptLibState.folder);
  } catch (err) { setStatus(`Create failed: ${err.message || err}`); }
});
scriptNewBtn.addEventListener("click", () => {
  openScriptEditor({ mode: "create", folder: scriptLibState.folder });
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && scriptLibState.open) {
    closeScriptLibrary();
  }
});

// ---- Script editor ------------------------------------------------------
let scriptEditorCtx = null;

function openScriptEditor(ctx) {
  scriptEditorCtx = ctx;
  scriptEditorError.hidden = true;
  scriptEditorError.textContent = "";
  if (ctx.mode === "edit" && ctx.item) {
    scriptEditorTitle.textContent = `Edit script - ${ctx.item.label}`;
    scriptEditorLabel.value = ctx.item.label || "";
    scriptEditorLanguage.value = ctx.item.language || "";
    scriptEditorDescription.value = ctx.item.description || "";
    scriptEditorBody.value = "Loading...";
    scriptEditorBody.disabled = true;
    fetch(`/api/scripts/file?filename=${encodeURIComponent(ctx.item.filename)}${ctx.folder ? `&folder=${encodeURIComponent(ctx.folder)}` : ""}`, {
      credentials: "same-origin"
    }).then((r) => r.json()).then((data) => {
      scriptEditorBody.value = String(data.body || "");
      scriptEditorBody.disabled = false;
    }).catch(() => {
      scriptEditorBody.value = "";
      scriptEditorBody.disabled = false;
    });
  } else {
    scriptEditorTitle.textContent = "New script";
    scriptEditorLabel.value = "";
    scriptEditorLanguage.value = "";
    scriptEditorDescription.value = "";
    scriptEditorBody.value = "";
    scriptEditorBody.disabled = false;
  }
  scriptEditorModal.classList.add("open");
  setTimeout(() => scriptEditorLabel.focus(), 50);
}

function closeScriptEditor() {
  scriptEditorModal.classList.remove("open");
  scriptEditorCtx = null;
}

scriptEditorCancel.addEventListener("click", closeScriptEditor);
scriptEditorModal.addEventListener("click", (event) => {
  if (event.target === scriptEditorModal) closeScriptEditor();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && scriptEditorModal.classList.contains("open")) {
    closeScriptEditor();
  }
});
scriptEditorSave.addEventListener("click", async () => {
  if (!scriptEditorCtx) return;
  const ctx = scriptEditorCtx;
  const label = scriptEditorLabel.value.trim();
  if (!label) {
    scriptEditorError.textContent = "Label is required.";
    scriptEditorError.hidden = false;
    return;
  }
  const body = scriptEditorBody.value;
  if (new TextEncoder().encode(body).length > appConfig.scripts.maxBytes) {
    scriptEditorError.textContent = `Script body exceeds ${fmtBytes(appConfig.scripts.maxBytes)} limit.`;
    scriptEditorError.hidden = false;
    return;
  }
  const description = scriptEditorDescription.value.trim();
  const language = scriptEditorLanguage.value.trim();
  try {
    let resp;
    if (ctx.mode === "edit" && ctx.item) {
      resp = await fetch(`/api/scripts/file`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder: ctx.folder || "",
          filename: ctx.item.filename,
          label,
          body,
          description,
          language
        })
      });
    } else {
      resp = await fetch(`/api/scripts`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder: ctx.folder || "",
          label,
          body,
          description,
          language
        })
      });
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      scriptEditorError.textContent = data.error || resp.statusText;
      scriptEditorError.hidden = false;
      return;
    }
    closeScriptEditor();
    refreshScriptLibrary(scriptLibState.folder);
    showToast(ctx.mode === "edit" ? "Script saved" : `Created "${label}"`);
  } catch (err) {
    scriptEditorError.textContent = err.message || String(err);
    scriptEditorError.hidden = false;
  }
});

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
  document.body.classList.remove("chat-panel-open");
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
  // Lifts the script-library side panel above the chat dialog so the
  // two right-edge surfaces don't overlap (see .script-side-panel CSS).
  document.body.classList.toggle("chat-panel-open", next);
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
loadUserPrefs();
applyUserPrefs();
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
