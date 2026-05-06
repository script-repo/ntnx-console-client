import RFB from "/vendor/novnc/core/rfb.js";

const pcHostInput = document.getElementById("pcHost");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const vmUuidInput = document.getElementById("vmUuid");
const nameFilterInput = document.getElementById("nameFilter");
const powerStateFilter = document.getElementById("powerStateFilter");
const categoryFilter = document.getElementById("categoryFilter");
const rememberProfileInput = document.getElementById("rememberProfile");
const allowSelfSignedTlsInput = document.getElementById("allowSelfSignedTls");
const includeHiddenVmsInput = document.getElementById("includeHiddenVms");
const loadVmsBtn = document.getElementById("loadVmsBtn");
const showAllBtn = document.getElementById("showAllBtn");
const showFavoritesBtn = document.getElementById("showFavoritesBtn");
const favoritesListEl = document.getElementById("favoritesList");
const vmListEl = document.getElementById("vmList");
const statusEl = document.getElementById("status");
const connectBtn = document.getElementById("connectBtn");
const consoleTabsEl = document.getElementById("consoleTabs");
const screenStageEl = document.getElementById("screenStage");

const profileStorageKey = "ntnxConsoleProfile";
const favoritesStorageKey = "ntnxConsoleFavoriteVms";

const peCredsModal = document.getElementById("peCredsModal");
const peCredsHostLabel = document.getElementById("peCredsHost");
const peCredsHostInput = document.getElementById("peCredsHostInput");
const peCredsUsernameInput = document.getElementById("peCredsUsername");
const peCredsPasswordInput = document.getElementById("peCredsPassword");
const peCredsErrorEl = document.getElementById("peCredsError");
const peCredsCancelBtn = document.getElementById("peCredsCancel");
const peCredsSaveBtn = document.getElementById("peCredsSave");
const forgetPeCredsBtn = document.getElementById("forgetPeCredsBtn");

// Set of PE hosts the NRCC server currently has cached credentials for, in
// its own in-memory session store. The browser never holds the credentials
// themselves -- only the host names, so the UI knows when a re-prompt is
// needed.
let serverPeHosts = new Set();

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
      // Wipe the password from the input so it doesn't linger in the DOM.
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
            tlsSkipVerify: allowSelfSignedTlsInput.checked
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
let vmCache = [];
let favoriteVmIds = new Set();
let showOnlyFavorites = false;
let sessions = [];
let activeSessionId = null;

function setStatus(message) {
  statusEl.textContent = message;
}

function loadSavedProfile() {
  try {
    const raw = localStorage.getItem(profileStorageKey);
    if (!raw) {
      return;
    }
    const profile = JSON.parse(raw);
    if (profile?.pcHost) {
      pcHostInput.value = profile.pcHost;
    }
    if (profile?.username) {
      usernameInput.value = profile.username;
    }
    rememberProfileInput.checked = true;
  } catch (_error) {
    localStorage.removeItem(profileStorageKey);
  }
}

function persistProfileIfNeeded(pcHost, username) {
  if (rememberProfileInput.checked) {
    localStorage.setItem(profileStorageKey, JSON.stringify({ pcHost, username }));
    return;
  }
  localStorage.removeItem(profileStorageKey);
}

function loadFavorites() {
  try {
    const raw = localStorage.getItem(favoritesStorageKey);
    if (!raw) {
      return;
    }
    const ids = JSON.parse(raw);
    if (Array.isArray(ids)) {
      favoriteVmIds = new Set(ids);
    }
  } catch (_error) {
    localStorage.removeItem(favoritesStorageKey);
  }
}

function persistFavorites() {
  localStorage.setItem(favoritesStorageKey, JSON.stringify([...favoriteVmIds]));
}

function getVmByUuid(vmId) {
  return vmCache.find((vm) => vm.uuid === vmId);
}

function selectVm(vm) {
  vmUuidInput.value = vm.uuid;
  renderVmLists();
}

function toggleFavorite(vmId) {
  if (favoriteVmIds.has(vmId)) {
    favoriteVmIds.delete(vmId);
  } else {
    favoriteVmIds.add(vmId);
  }
  persistFavorites();
  renderVmLists();
}

function createVmRow(vm) {
  const row = document.createElement("div");
  row.className = "vm-row";
  const isActive = vmUuidInput.value.trim() === vm.uuid;
  row.innerHTML = `
    <button class="star">${favoriteVmIds.has(vm.uuid) ? "★" : "☆"}</button>
    <div class="vm-item ${isActive ? "active" : ""}">
      <div class="vm-name">${vm.name}<span class="state-pill" data-state="${vm.powerState || "UNKNOWN"}">${vm.powerState || "UNKNOWN"}</span></div>
      <div class="vm-meta">${[
        vm.isControllerVm ? "CVM" : null,
        vm.isFsvm ? "FSVM" : null,
        vm.isHidden ? "Hidden" : null,
        vm.consoleSupported === false ? "Console N/A" : null,
        vm.ipAddress || null,
        (vm.categories || []).join(", ") || "No category"
      ]
        .filter(Boolean)
        .join(" | ")}</div>
    </div>
  `;
  const starBtn = row.querySelector(".star");
  const vmItem = row.querySelector(".vm-item");
  starBtn.addEventListener("click", () => toggleFavorite(vm.uuid));
  vmItem.addEventListener("click", () => selectVm(vm));
  return row;
}

function applyFilters(vms) {
  const search = nameFilterInput.value.trim().toLowerCase();
  const power = powerStateFilter.value;
  const category = categoryFilter.value;
  return vms.filter((vm) => {
    const haystack = [
      vm.name,
      vm.uuid,
      vm.ipAddress,
      vm.isControllerVm ? "cvm ntnx controller" : "",
      vm.isFsvm ? "fsvm files" : "",
      vm.isHidden ? "hidden system" : ""
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const nameOk = !search || haystack.includes(search);
    const powerOk = !power || (vm.powerState || "UNKNOWN") === power;
    const categoryOk =
      !category || (vm.categories || []).some((item) => item === category);
    return nameOk && powerOk && categoryOk;
  });
}

function fillFilterOptions() {
  const powerStates = Array.from(
    new Set(vmCache.map((vm) => vm.powerState || "UNKNOWN"))
  ).sort();
  const categories = Array.from(
    new Set(vmCache.flatMap((vm) => vm.categories || []))
  ).sort();

  powerStateFilter.innerHTML = '<option value="">All power states</option>';
  powerStates.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    powerStateFilter.appendChild(option);
  });

  categoryFilter.innerHTML = '<option value="">All categories</option>';
  categories.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    categoryFilter.appendChild(option);
  });
}

function resetFiltersToShowAll() {
  nameFilterInput.value = "";
  powerStateFilter.value = "";
  categoryFilter.value = "";
  showOnlyFavorites = false;
}

function renderVmLists() {
  favoritesListEl.innerHTML = "";
  vmListEl.innerHTML = "";

  const filtered = applyFilters(vmCache);
  const favorites = filtered.filter((vm) => favoriteVmIds.has(vm.uuid));
  const regular = showOnlyFavorites
    ? favorites
    : filtered.filter((vm) => !favoriteVmIds.has(vm.uuid));

  if (!favorites.length) {
    favoritesListEl.innerHTML = '<div class="muted">No favorites match filters.</div>';
  } else {
    favorites.forEach((vm) => favoritesListEl.appendChild(createVmRow(vm)));
  }

  if (!regular.length) {
    vmListEl.innerHTML = '<div class="muted">No VMs to display.</div>';
  } else {
    regular.forEach((vm) => vmListEl.appendChild(createVmRow(vm)));
  }
}

async function loadVms() {
  const pcHost = pcHostInput.value.trim();
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  const tlsSkipVerify = allowSelfSignedTlsInput.checked;
  const includeHiddenVms = includeHiddenVmsInput.checked;
  if (!pcHost || !username || !password) {
    setStatus("Enter Prism host, username, and password before loading VMs.");
    return;
  }

  persistProfileIfNeeded(pcHost, username);
  setStatus("Loading VM list...");

  try {
    const resp = await fetch("/api/vms", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pcHost,
        username,
        password,
        tlsSkipVerify,
        includeHiddenVms
      })
    });
    const data = await resp.json();
    if (!resp.ok) {
      const detailText = data.details ? ` ${data.details}` : "";
      throw new Error((data.error || "Failed to load VMs.") + detailText);
    }
    vmCache = Array.isArray(data.vms) ? data.vms : [];
    fillFilterOptions();
    resetFiltersToShowAll();
    renderVmLists();
    const probeOkWithData = (data.cvmProbeSummary || []).filter(
      (p) => p.ok && p.count > 0
    ).length;
    setStatus(
      `Loaded ${vmCache.length} VMs` +
        `${data.hiddenCount ? ` (${data.hiddenCount} hidden/system)` : ""}` +
        ` (${data.cvmCount || 0} CVM)` +
        ` (${data.fsvmCount || 0} FSVM)` +
        `${data.cvmProbeSummary ? ` [CVM probes ok: ${probeOkWithData}]` : ""}` +
        `${data.listVariant ? ` via ${data.listVariant}` : ""}.`
    );

    const probeDetailsEl = document.getElementById("probeDetails");
    const probeDetailsContentEl = document.getElementById("probeDetailsContent");
    if (Array.isArray(data.cvmProbeSummary) && data.cvmProbeSummary.length) {
      const lines = data.cvmProbeSummary.map((p) =>
        p.ok
          ? `OK  count=${p.count}  ${p.url}`
          : `ERR status=${p.status}  ${p.url}${p.message ? `\n      msg: ${p.message}` : ""}`
      );
      probeDetailsContentEl.textContent = lines.join("\n");
      probeDetailsEl.style.display = "block";
      probeDetailsEl.open = (data.cvmCount || 0) === 0;
      console.group("CVM probe details");
      lines.forEach((l) => console.log(l));
      console.groupEnd();
    } else {
      probeDetailsEl.style.display = "none";
      probeDetailsContentEl.textContent = "";
    }
  } catch (error) {
    setStatus(`Error loading VMs: ${error.message}`);
  }
}

function setActiveSession(sessionId) {
  activeSessionId = sessionId;
  sessions.forEach((session) => {
    session.tabEl.classList.toggle("active", session.id === sessionId);
    session.screenEl.classList.toggle("active", session.id === sessionId);
  });
}

function closeSession(sessionId) {
  const idx = sessions.findIndex((item) => item.id === sessionId);
  if (idx < 0) {
    return;
  }
  const session = sessions[idx];
  try {
    session.rfb.disconnect();
  } catch (_error) {
    // Ignore disconnect issues.
  }
  session.tabEl.remove();
  session.screenEl.remove();
  sessions.splice(idx, 1);

  if (activeSessionId === sessionId) {
    if (sessions.length) {
      setActiveSession(sessions[sessions.length - 1].id);
    } else {
      activeSessionId = null;
    }
  }
}

function createSessionTab(session) {
  const tab = document.createElement("div");
  tab.className = "tab";
  tab.innerHTML = `
    <span>${session.vmName}</span>
    <button class="tab-close" aria-label="Close tab">x</button>
  `;
  tab.addEventListener("click", () => setActiveSession(session.id));
  const closeBtn = tab.querySelector(".tab-close");
  closeBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    closeSession(session.id);
  });
  return tab;
}

async function connectConsole() {
  const pcHost = pcHostInput.value.trim();
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  const tlsSkipVerify = allowSelfSignedTlsInput.checked;
  const vmUuid = vmUuidInput.value.trim();
  if (!pcHost || !username || !password || !vmUuid) {
    setStatus("Please enter Prism host, username, password, and VM UUID.");
    return;
  }

  persistProfileIfNeeded(pcHost, username);

  const selectedVm = getVmByUuid(vmUuid);
  const tokenBody = {
    pcHost,
    username,
    password,
    vmUuid,
    tlsSkipVerify,
    peHost: selectedVm?.peHost,
    cvmIp: selectedVm?.cvmIp || selectedVm?.ipAddress,
    cvmName: selectedVm?.cvmName || selectedVm?.name
  };

  if (selectedVm?.peHost) {
    if (!serverPeHosts.has(selectedVm.peHost)) {
      setStatus(`Need PE credentials for ${selectedVm.peHost}...`);
      const ok = await promptForPeCreds(selectedVm.peHost);
      if (!ok) {
        setStatus("Cancelled. PE credentials are required for this CVM.");
        return;
      }
    }
    setStatus(`Requesting console token via PE ${selectedVm.peHost}...`);
  } else {
    setStatus("Requesting console token...");
  }

  try {
    let resp = await fetch("/api/console-token", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tokenBody)
    });
    let data = await resp.json();

    // If the server says it has no creds for this PE (or PE rejected the
    // cached creds), drop them and re-prompt once.
    if (
      !resp.ok &&
      selectedVm?.peHost &&
      (data?.needPeCredentials || resp.status === 401)
    ) {
      await dropPeCreds(selectedVm.peHost);
      setStatus(`PE credentials needed for ${selectedVm.peHost}.`);
      const ok = await promptForPeCreds(selectedVm.peHost);
      if (!ok) {
        setStatus("Cancelled. PE credentials are required for this CVM.");
        return;
      }
      setStatus(`Retrying console token via PE ${selectedVm.peHost}...`);
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
    const vm = getVmByUuid(vmUuid);
    const vmName = vm?.name || vmUuid;
    const existing = sessions.find((item) => item.vmUuid === vmUuid);
    if (existing) {
      setActiveSession(existing.id);
      setStatus(`Switched to existing tab: ${vmName}`);
      return;
    }

    const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const screenEl = document.createElement("div");
    screenEl.className = "console-pane";
    screenStageEl.appendChild(screenEl);

    setStatus("Connecting to VNC WebSocket...");
    const rfb = new RFB(screenEl, wsUrl, {
      credentials: {}
    });
    rfb.scaleViewport = true;
    rfb.resizeSession = true;
    rfb.background = "#000";

    rfb.addEventListener("connect", () => setStatus(`Connected: ${vmName}`));
    rfb.addEventListener("disconnect", (event) =>
      setStatus(`Disconnected ${vmName}. Clean: ${event.detail.clean}`)
    );
    rfb.addEventListener("securityfailure", (event) =>
      setStatus(`Security failure (${vmName}): ${event.detail.status}`)
    );

    const session = { id: sessionId, vmUuid, vmName, rfb, screenEl, tabEl: null };
    const tabEl = createSessionTab(session);
    session.tabEl = tabEl;
    sessions.push(session);
    consoleTabsEl.appendChild(tabEl);
    setActiveSession(sessionId);
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  }
}

loadSavedProfile();
loadFavorites();
renderVmLists();
refreshPeCredsCache();
connectBtn.addEventListener("click", connectConsole);
loadVmsBtn.addEventListener("click", loadVms);
showAllBtn.addEventListener("click", () => {
  showOnlyFavorites = false;
  renderVmLists();
});
showFavoritesBtn.addEventListener("click", () => {
  showOnlyFavorites = true;
  renderVmLists();
});
if (forgetPeCredsBtn) {
  forgetPeCredsBtn.addEventListener("click", clearAllPeCreds);
}
vmUuidInput.addEventListener("input", renderVmLists);
nameFilterInput.addEventListener("input", renderVmLists);
powerStateFilter.addEventListener("change", renderVmLists);
categoryFilter.addEventListener("change", renderVmLists);
