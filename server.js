const path = require("path");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { URL } = require("url");
const express = require("express");
const axios = require("axios");
const { WebSocketServer, WebSocket } = require("ws");
require("dotenv").config();

const app = express();
const port = Number(process.env.PORT || 3000);
const wsProxySessions = new Map();
const vmListVariantCache = new Map();

// Default per-request timeout for Prism HTTP calls. Real Prism Central
// instances under load routinely take 5-15 seconds to return a v4 vmm
// page, so the historical 5 s probe timeout was too aggressive and
// surfaced as `Failed to list VMs. timeout of 5000ms exceeded`. Override
// with NUTANIX_API_TIMEOUT_MS in the environment if your PC is slower
// still.
const PRISM_HTTP_TIMEOUT_MS = Math.max(
  3000,
  Number(process.env.NUTANIX_API_TIMEOUT_MS || 30000)
);

// PE credentials live only in this in-memory map, scoped to an opaque
// HttpOnly session cookie. They are never written to disk and never sent
// back to the browser. They evaporate when the NRCC process restarts or
// after SESSION_TTL_MS of inactivity.
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const serverSessions = new Map();

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(";").forEach((part) => {
    const eq = part.indexOf("=");
    if (eq < 0) return;
    const key = part.slice(0, eq).trim();
    if (!key) return;
    try {
      out[key] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch (_error) {
      out[key] = part.slice(eq + 1).trim();
    }
  });
  return out;
}

function setSessionCookie(res, sid) {
  res.cookie("nrcc_sid", sid, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_MS
  });
}

function ensureSession(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  let sid = cookies.nrcc_sid;
  let session = sid ? serverSessions.get(sid) : null;
  const now = Date.now();
  if (!session || now - session.lastSeenAtMs > SESSION_TTL_MS) {
    if (sid) serverSessions.delete(sid);
    sid = crypto.randomUUID();
    session = {
      peCreds: new Map(),
      createdAtMs: now,
      lastSeenAtMs: now
    };
    serverSessions.set(sid, session);
  } else {
    session.lastSeenAtMs = now;
  }
  setSessionCookie(res, sid);
  req.nrccSession = session;
  req.nrccSid = sid;
  next();
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(
  "/vendor/novnc",
  express.static(path.join(__dirname, "node_modules", "@novnc", "novnc"))
);
app.use("/api", ensureSession);

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/pe-creds", (req, res) => {
  const peHosts = Array.from(req.nrccSession.peCreds.keys()).sort();
  res.json({ peHosts });
});

app.delete("/api/pe-creds", (req, res) => {
  const cleared = req.nrccSession.peCreds.size;
  req.nrccSession.peCreds.clear();
  res.json({ cleared });
});

app.delete("/api/pe-creds/:peHost", (req, res) => {
  const removed = req.nrccSession.peCreds.delete(req.params.peHost);
  res.json({ removed });
});

function resolveAuth(body) {
  const pcHost = (body.pcHost || process.env.NUTANIX_PC_HOST || "").trim();
  const username = (body.username || process.env.NUTANIX_USERNAME || "").trim();
  const password = body.password || process.env.NUTANIX_PASSWORD || "";
  const tlsSkipVerify =
    typeof body.tlsSkipVerify === "boolean"
      ? body.tlsSkipVerify
      : process.env.NUTANIX_TLS_SKIP_VERIFY === "true";
  const includeHiddenVms =
    typeof body.includeHiddenVms === "boolean" ? body.includeHiddenVms : true;

  return { pcHost, username, password, tlsSkipVerify, includeHiddenVms };
}

function createPrismClient(pcHost, username, password, tlsSkipVerify) {
  const client = axios.create({
    auth: { username, password },
    headers: { "Content-Type": "application/json" },
    timeout: PRISM_HTTP_TIMEOUT_MS,
    // Lab-only: allow self-signed certs when explicitly enabled.
    httpsAgent: new https.Agent({
      rejectUnauthorized: !tlsSkipVerify
    }),
    baseURL: `https://${pcHost}:9440`
  });

  client.interceptors.request.use((config) => {
    const reqId = crypto.randomUUID();
    config.headers = config.headers || {};
    // Some Prism builds validate one of these request-id headers.
    config.headers["NTNX-Request-Id"] = reqId;
    config.headers["X-Request-Id"] = reqId;
    return config;
  });

  return client;
}

function createCookieClient(pcHost, sessionCookie, tlsSkipVerify) {
  const client = axios.create({
    headers: {
      Cookie: sessionCookie
    },
    timeout: 12000,
    httpsAgent: new https.Agent({
      rejectUnauthorized: !tlsSkipVerify
    }),
    baseURL: `https://${pcHost}:9440`
  });
  client.interceptors.request.use((config) => {
    const reqId = crypto.randomUUID();
    config.headers = config.headers || {};
    config.headers["NTNX-Request-Id"] = reqId;
    config.headers["X-Request-Id"] = reqId;
    return config;
  });
  return client;
}

function extractCookieHeader(setCookieHeader) {
  if (!Array.isArray(setCookieHeader)) {
    return "";
  }
  return setCookieHeader
    .map((cookie) => String(cookie).split(";")[0])
    .filter(Boolean)
    .join("; ");
}

async function createPrismSessionCookie(client, username, password) {
  try {
    const resp = await client.post("/api/nutanix/v3/users/login", {
      username,
      password
    });
    return extractCookieHeader(resp.headers?.["set-cookie"]);
  } catch (_error) {
    return "";
  }
}

async function createPrismLegacySessionCookie(client, username, password) {
  // PE PrismGateway endpoints: try a few that are known to set session
  // cookies. j_spring_security_check is the most common, and it accepts
  // form-urlencoded credentials.
  const candidates = [
    {
      url: "/PrismGateway/j_spring_security_check",
      contentType: "application/x-www-form-urlencoded",
      body: `j_username=${encodeURIComponent(username)}&j_password=${encodeURIComponent(password)}`
    },
    {
      url: "/PrismGateway/services/rest/v1/utils/loginActions",
      contentType: "application/json",
      body: JSON.stringify({})
    },
    {
      url: "/api/nutanix/v3/users/login",
      contentType: "application/json",
      body: JSON.stringify({ username, password })
    }
  ];
  for (const c of candidates) {
    try {
      const resp = await client.post(c.url, c.body, {
        headers: { "Content-Type": c.contentType },
        // We don't care about non-2xx for j_spring (often 302 to /console/login).
        validateStatus: () => true,
        timeout: 7000
      });
      const cookie = extractCookieHeader(resp.headers?.["set-cookie"]);
      if (cookie) {
        console.log(
          `[pe-legacy-auth] cookie obtained via ${c.url} status=${resp.status}`
        );
        return cookie;
      }
    } catch (_error) {
      // Try next.
    }
  }
  console.log("[pe-legacy-auth] no session cookie obtained");
  return "";
}

function collectVmIpAddresses(vm) {
  const out = new Set();
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    // Common shapes: { ipAddress: { value: "1.2.3.4" } } or { ipAddress: "1.2.3.4" }
    // or { value: "1.2.3.4" } inside ipv4Config / secondaryIpAddressList / ipAddresses.
    for (const [key, val] of Object.entries(node)) {
      if (
        typeof val === "string" &&
        /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(val) &&
        /(ip|address)/i.test(key)
      ) {
        out.add(val);
      } else if (val && typeof val === "object") {
        visit(val);
      }
    }
  };
  // Look at the most likely locations first to avoid sweeping unrelated fields.
  const roots = [
    vm?.nics,
    vm?.spec?.resources?.nicList,
    vm?.status?.resources?.nicList,
    vm?.networkConfig,
    vm?.networkInfo
  ];
  roots.forEach(visit);
  // Fallback: scan whole record (cheap for these small objects).
  if (out.size === 0) visit(vm);
  return Array.from(out);
}

function parseVmList(vmResponse) {
  const list =
    vmResponse?.data?.data?.entities ||
    vmResponse?.data?.data ||
    vmResponse?.data?.entities ||
    vmResponse?.data?.vms ||
    vmResponse?.data ||
    [];
  const vms = Array.isArray(list) ? list : [];
  return vms
    .map((vm) => {
      const categoriesRaw =
        vm?.categories ||
        vm?.metadata?.categories ||
        vm?.status?.resources?.categories ||
        vm?.spec?.resources?.categories ||
        vm?.spec?.categories ||
        {};
      let categories = [];
      if (Array.isArray(categoriesRaw)) {
        categories = categoriesRaw.map((item) => String(item));
      } else if (categoriesRaw && typeof categoriesRaw === "object") {
        categories = Object.entries(categoriesRaw).map(
          ([key, value]) => `${key}:${value}`
        );
      }

      const resolvedName =
        vm?.name ||
        vm?.spec?.name ||
        vm?.spec?.resources?.name ||
        vm?.status?.name ||
        vm?.status?.resources?.name ||
        vm?.metadata?.name ||
        vm?.vmName ||
        "Unnamed VM";

      const ipAddresses = collectVmIpAddresses(vm);
      return {
        uuid:
          vm?.extId ||
          vm?.id ||
          vm?.uuid ||
          vm?.metadata?.uuid ||
          vm?.status?.resources?.uuid ||
          "",
        name: resolvedName,
        powerState:
          vm?.status?.resources?.powerState ||
          vm?.powerState ||
          vm?.status?.powerState ||
          "UNKNOWN",
        isHidden:
          Boolean(vm?.isHidden) ||
          Boolean(vm?.status?.resources?.isHidden) ||
          Boolean(vm?.spec?.resources?.isHidden),
        isControllerVm:
          Boolean(vm?.isControllerVm) ||
          Boolean(vm?.status?.resources?.isControllerVm) ||
          Boolean(vm?.spec?.resources?.isControllerVm) ||
          /(^|[-_ ])cvm([-_ ]|$)/i.test(String(resolvedName)) ||
          /-cvm$/i.test(String(resolvedName)),
        isFsvm:
          /(^|[-_ ])fsvm([-_ ]|$)/i.test(String(resolvedName)) ||
          /(file|files)[-_ ]server/i.test(String(resolvedName)),
        categories,
        ipAddresses,
        ipAddress: ipAddresses[0]
      };
    })
    .filter((vm) => vm.uuid)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function parseGenericEntityList(response) {
  const list =
    response?.data?.data?.entities ||
    response?.data?.data ||
    response?.data?.entities ||
    response?.data ||
    [];
  return Array.isArray(list) ? list : [];
}

function _mapControllerEntityToVm(entity) {
  const name =
    entity?.name ||
    entity?.spec?.name ||
    entity?.status?.name ||
    entity?.metadata?.name ||
    "Unnamed CVM";
  const uuid =
    entity?.extId ||
    entity?.id ||
    entity?.uuid ||
    entity?.metadata?.uuid ||
    entity?.status?.resources?.uuid ||
    "";
  if (!uuid) {
    return null;
  }
  return {
    uuid,
    name,
    powerState:
      entity?.status?.resources?.powerState ||
      entity?.status?.powerState ||
      "UNKNOWN",
    isHidden: true,
    isControllerVm: true,
    isFsvm: false,
    categories: []
  };
}

async function fetchControllerVmCandidates(_client) {
  // The vmm-side controller-vm/cvms endpoints are not exposed in this Prism build.
  // CVM discovery uses the clustermgmt CVM endpoint instead (see fetchClusterCvms).
  return { vms: [], probeResults: [] };
}

async function fetchClusterExternalAddress(client, clusterExtId) {
  if (!clusterExtId) return "";
  const versions = ["v4.0", "v4.1", "v4.2"];
  for (const v of versions) {
    const url = `/api/clustermgmt/${v}/config/clusters/${clusterExtId}`;
    try {
      const resp = await client.get(url, { timeout: 7000 });
      const body = resp?.data?.data || resp?.data || {};
      const ip =
        body?.network?.externalAddress?.ipv4?.value ||
        body?.network?.externalAddress?.value ||
        body?.network?.externalIpAddress?.ipv4?.value ||
        body?.network?.externalIpAddress?.value ||
        body?.externalAddress?.ipv4?.value ||
        body?.externalAddress?.value ||
        body?.externalIpAddress?.ipv4?.value ||
        body?.externalIpAddress?.value ||
        "";
      if (typeof ip === "string" && ip.trim()) {
        return ip.trim();
      }
      // Fallback: any field whose key looks like external + IPv4-shaped value.
      let found = "";
      const visit = (node) => {
        if (!node || typeof node !== "object" || found) return;
        if (Array.isArray(node)) {
          node.forEach(visit);
          return;
        }
        for (const [k, v] of Object.entries(node)) {
          if (
            typeof v === "string" &&
            /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v) &&
            /external/i.test(k)
          ) {
            found = v;
            return;
          }
          if (v && typeof v === "object") visit(v);
        }
      };
      visit(body);
      if (found) return found;
    } catch (_error) {
      // Try next version.
    }
  }
  return "";
}

async function listClusterIds(client) {
  const candidateUrls = [
    "/api/clustermgmt/v4.0/config/clusters?$limit=100",
    "/api/clustermgmt/v4.1/config/clusters?$limit=100",
    "/api/clustermgmt/v4.2/config/clusters?$limit=100",
    "/api/clustermgmt/v4.0/config/clusters",
    "/api/clustermgmt/v4.1/config/clusters",
    "/api/clustermgmt/v4.2/config/clusters"
  ];
  const probeResults = [];
  for (const url of candidateUrls) {
    try {
      const resp = await client.get(url, { timeout: 7000 });
      const entities = parseGenericEntityList(resp);
      probeResults.push({ url, ok: true, count: entities.length });
      const ids = entities
        .map(
          (cluster) =>
            cluster?.extId ||
            cluster?.id ||
            cluster?.uuid ||
            cluster?.metadata?.uuid ||
            ""
        )
        .filter(Boolean);
      if (ids.length) {
        return {
          ids,
          baseVersion: url.match(/v4\.\d/)?.[0] || "v4.0",
          probeResults
        };
      }
    } catch (error) {
      const data = error.response?.data;
      const errMsg =
        typeof data === "string"
          ? data.slice(0, 240)
          : data
            ? JSON.stringify(data).slice(0, 240)
            : error.message || "";
      probeResults.push({
        url,
        ok: false,
        status: error.response?.status || null,
        message: errMsg
      });
    }
  }
  return { ids: [], baseVersion: "v4.0", probeResults };
}

function pickFirstIpAddress(entity) {
  const candidates = [
    typeof entity?.ipAddress === "string" ? entity.ipAddress : null,
    entity?.ipAddress?.ipv4?.value,
    entity?.ipAddress?.value,
    entity?.ipAddress?.address,
    typeof entity?.externalAddress === "string" ? entity.externalAddress : null,
    entity?.externalAddress?.ipv4?.value,
    entity?.externalAddress?.value,
    entity?.controllerVmExternalAddress,
    typeof entity?.internalAddress === "string" ? entity.internalAddress : null,
    entity?.internalAddress?.ipv4?.value,
    entity?.internalAddress?.value,
    entity?.controllerVmInternalAddress,
    entity?.dataIpv4Address?.value,
    entity?.externalIpv4Address?.value,
    entity?.internalIpv4Address?.value,
    entity?.controllerVmExternalIpv4Address?.value,
    entity?.backplaneIpv4Address?.value,
    Array.isArray(entity?.ipAddresses)
      ? entity.ipAddresses[0]?.ipv4?.value
      : null,
    Array.isArray(entity?.ipAddresses) ? entity.ipAddresses[0]?.value : null,
    Array.isArray(entity?.ipAddresses) ? entity.ipAddresses[0] : null,
    Array.isArray(entity?.ipv4Addresses) ? entity.ipv4Addresses[0]?.value : null
  ];
  for (const c of candidates) {
    if (typeof c === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(c.trim())) {
      return c.trim();
    }
  }
  // Last resort: deep search for any IPv4-shaped string under an "ip"-like key.
  let found = "";
  const visit = (node) => {
    if (!node || typeof node !== "object" || found) return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (
        typeof v === "string" &&
        /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v) &&
        /(ip|address)/i.test(k)
      ) {
        found = v;
        return;
      }
      if (v && typeof v === "object") visit(v);
    }
  };
  visit(entity);
  return found;
}

async function resolveAhvVmUuidByIpOrName(client, cvmIp, cvmName) {
  const wantedIp = (cvmIp || "").trim();
  const wantedName = (cvmName || "").trim().toLowerCase();
  const diagnostics = {
    triedUrls: [],
    totalVmsSeen: 0,
    sampleNames: [],
    sampleIps: []
  };

  const considerCandidate = (uuid, name, ips, source) => {
    if (!uuid) return null;
    if (diagnostics.sampleNames.length < 25) {
      diagnostics.sampleNames.push(`${name || "?"} (${source})`);
      diagnostics.sampleIps.push((ips || [])[0] || "");
    }
    if (wantedIp && (ips || []).some((ip) => ip === wantedIp)) {
      console.log(
        `[pe-resolve] matched by IP ${wantedIp} -> uuid=${uuid} name=${name} via ${source}`
      );
      return uuid;
    }
    if (wantedName && name && name.toLowerCase() === wantedName) {
      console.log(
        `[pe-resolve] matched by name ${name} -> uuid=${uuid} via ${source}`
      );
      return uuid;
    }
    return null;
  };

  // Strategy 1 (best for PE): v3 groups endpoint with entity_type=vm.
  // Unlike vms/list and v2 PrismGateway/vms (both of which exclude CVMs),
  // groups returns ALL VMs including CVMs. The entity_id is the AHV VM UUID
  // that the legacy /vnc/vm/{uuid}/proxy endpoint accepts.
  try {
    const url = "/api/nutanix/v3/groups";
    const body = {
      entity_type: "vm",
      group_member_count: 500,
      group_member_attributes: [
        { attribute: "vm_name" },
        { attribute: "ip_addresses" },
        { attribute: "controller_vm" }
      ]
    };
    const resp = await client.post(url, body, { timeout: 12000 });
    const rows =
      resp?.data?.group_results?.[0]?.entity_results || [];
    diagnostics.triedUrls.push({
      url,
      ok: true,
      count: rows.length,
      source: "v3-groups"
    });
    diagnostics.totalVmsSeen += rows.length;
    const attrOf = (row, name) => {
      for (const d of row?.data || []) {
        if (d?.name === name) {
          const v = d?.values?.[0]?.values;
          if (Array.isArray(v) && v.length) return v;
        }
      }
      return [];
    };
    for (const row of rows) {
      const uuid = row?.entity_id || "";
      const names = attrOf(row, "vm_name");
      const name = names[0] || "";
      const ips = attrOf(row, "ip_addresses");
      const matched = considerCandidate(uuid, name, ips, "v3-groups");
      if (matched) return { uuid: matched, diagnostics };
    }
  } catch (error) {
    diagnostics.triedUrls.push({
      url: "/api/nutanix/v3/groups",
      ok: false,
      status: error.response?.status || null,
      message:
        (typeof error.response?.data === "string"
          ? error.response.data
          : JSON.stringify(error.response?.data || "")
        ).slice(0, 200) || error.message || "",
      source: "v3-groups"
    });
  }

  // Strategy 2: v4 AHV VMs API (paginated).
  const v4BaseUrls = [
    "/api/vmm/v4.0/ahv/config/vms?$limit=100&$includeHidden=true",
    "/api/vmm/v4.1/ahv/config/vms?$limit=100&$includeHidden=true",
    "/api/vmm/v4.2/ahv/config/vms?$limit=100&$includeHidden=true",
    "/api/vmm/v4.0/ahv/config/vms?$limit=100",
    "/api/vmm/v4.1/ahv/config/vms?$limit=100",
    "/api/vmm/v4.2/ahv/config/vms?$limit=100"
  ];
  for (const baseUrl of v4BaseUrls) {
    let offset = 0;
    let total = 0;
    for (let page = 0; page < 20; page += 1) {
      const url = `${baseUrl}&$page=${offset}`;
      let resp;
      try {
        resp = await client.get(url, { timeout: 8000 });
      } catch (error) {
        diagnostics.triedUrls.push({
          url,
          ok: false,
          status: error.response?.status || null,
          message:
            (typeof error.response?.data === "string"
              ? error.response.data
              : JSON.stringify(error.response?.data || "")
            ).slice(0, 200) || error.message || "",
          source: "v4-vmm"
        });
        break;
      }
      const vms = parseVmList(resp);
      diagnostics.triedUrls.push({
        url,
        ok: true,
        count: vms.length,
        source: "v4-vmm"
      });
      diagnostics.totalVmsSeen += vms.length;
      if (page === 0) {
        const respShape = JSON.stringify(resp.data).slice(0, 240);
        console.log(`[pe-resolve] ${url} status=${resp.status} body=${respShape}`);
      }
      for (const vm of vms) {
        const matched = considerCandidate(
          vm.uuid,
          vm.name,
          vm.ipAddresses,
          "v4-vmm"
        );
        if (matched) return { uuid: matched, diagnostics };
      }
      const pageInfo = extractV4PageInfo(resp);
      if (pageInfo.totalAvailableResults > 0) {
        total = pageInfo.totalAvailableResults;
      }
      if (vms.length < 100 || (total && (offset + 1) * 100 >= total)) {
        break;
      }
      offset += 1;
    }
  }

  // Strategy 2.4: PE hosts endpoint exposes the AHV VM UUID of each node's
  // controller VM directly (controller_vm_id / controller_vm.uuid), and the
  // CVM IP. This is the most reliable source for CVM UUIDs on PE.
  const hostsUrls = [
    "/PrismGateway/services/rest/v2.0/hosts",
    "/PrismGateway/services/rest/v1/hosts",
    "/api/nutanix/v3/hosts/list"
  ];
  for (const hostsUrl of hostsUrls) {
    try {
      const resp =
        hostsUrl.endsWith("/list")
          ? await client.post(
              hostsUrl,
              { kind: "host", length: 100 },
              { timeout: 10000 }
            )
          : await client.get(hostsUrl, { timeout: 10000 });
      const entities =
        resp?.data?.entities ||
        resp?.data?.entityList ||
        resp?.data ||
        [];
      const hostList = Array.isArray(entities) ? entities : [];
      diagnostics.triedUrls.push({
        url: hostsUrl,
        ok: true,
        count: hostList.length,
        source: "pe-hosts"
      });
      if (hostList.length && hostList[0]) {
        const sampleKeys = Object.keys(hostList[0]).join(",");
        console.log(`[pe-hosts] ${hostsUrl} keys: ${sampleKeys}`);
        console.log(
          `[pe-hosts] first host preview: ${JSON.stringify(hostList[0]).slice(0, 600)}`
        );
      }
      for (const host of hostList) {
        // Possible CVM UUID fields:
        const cvmUuid =
          host?.controller_vm_id ||
          host?.controller_vm?.uuid ||
          host?.controllerVmId ||
          host?.controllerVm?.uuid ||
          host?.serviceVMId ||
          host?.service_vm_id ||
          host?.cvm_uuid ||
          host?.controller_vm_backplane_ip ||
          "";
        // Possible CVM IP fields:
        const cvmIpHere =
          host?.controller_vm_external_ip ||
          host?.controller_vm?.external_ip ||
          host?.cvm_external_ip ||
          host?.serviceVMExternalIP ||
          host?.service_vm_external_ip ||
          host?.controllerVmExternalIp ||
          host?.cvmIp ||
          "";
        const cvmHostName =
          host?.name || host?.hypervisor_full_name || host?.hostName || "";
        if (diagnostics.sampleNames.length < 25 && cvmUuid) {
          diagnostics.sampleNames.push(
            `host=${cvmHostName} cvmIp=${cvmIpHere} cvmUuid=${cvmUuid} (pe-hosts)`
          );
        }
        if (cvmUuid && wantedIp && cvmIpHere === wantedIp) {
          console.log(
            `[pe-resolve] matched CVM by host.cvmIp=${wantedIp} -> uuid=${cvmUuid}`
          );
          return { uuid: cvmUuid, diagnostics };
        }
      }
      // Stop after first hosts endpoint that returned data.
      if (hostList.length) break;
    } catch (error) {
      diagnostics.triedUrls.push({
        url: hostsUrl,
        ok: false,
        status: error.response?.status || null,
        message:
          (typeof error.response?.data === "string"
            ? error.response.data
            : JSON.stringify(error.response?.data || "")
          ).slice(0, 200) || error.message || "",
        source: "pe-hosts"
      });
    }
  }

  // Strategy 2.5: PE v2 PrismGateway vms (includes controller VMs by default).
  try {
    const url = "/PrismGateway/services/rest/v2.0/vms?include_vm_nic_config=true";
    const resp = await client.get(url, { timeout: 10000 });
    const entities = resp?.data?.entities || [];
    diagnostics.triedUrls.push({
      url,
      ok: true,
      count: entities.length,
      source: "v2-prismgw"
    });
    diagnostics.totalVmsSeen += entities.length;
    for (const entity of entities) {
      const uuid = entity?.uuid || "";
      const name = entity?.name || "";
      const ips = [];
      (entity?.vm_nics || []).forEach((nic) => {
        if (nic?.ip_address) ips.push(nic.ip_address);
        (nic?.ip_addresses || []).forEach((ip) => ips.push(ip));
      });
      const matched = considerCandidate(uuid, name, ips, "v2-prismgw");
      if (matched) return { uuid: matched, diagnostics };
    }
  } catch (error) {
    diagnostics.triedUrls.push({
      url: "/PrismGateway/services/rest/v2.0/vms?include_vm_nic_config=true",
      ok: false,
      status: error.response?.status || null,
      message:
        (typeof error.response?.data === "string"
          ? error.response.data
          : JSON.stringify(error.response?.data || "")
        ).slice(0, 200) || error.message || "",
      source: "v2-prismgw"
    });
  }

  // Strategy 3: v3 vms/list (older PEs).
  let v3Offset = 0;
  for (let page = 0; page < 20; page += 1) {
    const url = "/api/nutanix/v3/vms/list";
    try {
      const resp = await client.post(
        url,
        { kind: "vm", length: 250, offset: v3Offset },
        { timeout: 10000 }
      );
      const entities = resp?.data?.entities || [];
      diagnostics.triedUrls.push({
        url: `${url} (offset=${v3Offset})`,
        ok: true,
        count: entities.length,
        source: "v3-vms"
      });
      diagnostics.totalVmsSeen += entities.length;
      for (const entity of entities) {
        const uuid = entity?.metadata?.uuid || "";
        const name =
          entity?.spec?.name ||
          entity?.status?.name ||
          entity?.metadata?.name ||
          "";
        const nics =
          entity?.status?.resources?.nic_list ||
          entity?.spec?.resources?.nic_list ||
          [];
        const ips = [];
        nics.forEach((nic) => {
          (nic?.ip_endpoint_list || []).forEach((endpoint) => {
            if (endpoint?.ip) ips.push(endpoint.ip);
          });
        });
        const matched = considerCandidate(uuid, name, ips, "v3-vms");
        if (matched) return { uuid: matched, diagnostics };
      }
      const totalMatches = resp?.data?.metadata?.total_matches || 0;
      if (entities.length < 250 || v3Offset + 250 >= totalMatches) {
        break;
      }
      v3Offset += 250;
    } catch (error) {
      diagnostics.triedUrls.push({
        url: `${url} (offset=${v3Offset})`,
        ok: false,
        status: error.response?.status || null,
        message:
          (typeof error.response?.data === "string"
            ? error.response.data
            : JSON.stringify(error.response?.data || "")
          ).slice(0, 200) || error.message || "",
        source: "v3-vms"
      });
      break;
    }
  }

  console.log(
    `[pe-resolve] no match. total seen=${diagnostics.totalVmsSeen} sample=${diagnostics.sampleNames
      .slice(0, 10)
      .join(" | ")}`
  );
  console.log(
    `[pe-resolve] tried URLs:\n${diagnostics.triedUrls
      .map(
        (t) =>
          `  ${t.ok ? "OK" : "ERR"} status=${t.status ?? ""} count=${t.count ?? "-"} src=${t.source ?? ""} ${t.url} ${t.message ? `msg=${t.message}` : ""}`
      )
      .join("\n")}`
  );
  return { uuid: "", diagnostics };
}

function mapCvmEntityToVm(entity, clusterId) {
  const uuid =
    entity?.extId ||
    entity?.id ||
    entity?.uuid ||
    entity?.metadata?.uuid ||
    entity?.nodeUuid ||
    "";
  if (!uuid) {
    return null;
  }
  const ip = pickFirstIpAddress(entity);
  const rawName =
    entity?.name ||
    entity?.controllerVmName ||
    entity?.cvmName ||
    entity?.fqdn ||
    entity?.domainName ||
    entity?.hostName ||
    entity?.hostname ||
    entity?.nodeName ||
    "";
  const fallbackName = ip
    ? `NTNX-CVM ${ip}`
    : `NTNX-CVM ${uuid.slice(0, 8)}`;
  const name = rawName || fallbackName;
  return {
    uuid,
    name,
    powerState:
      entity?.powerState ||
      entity?.state ||
      entity?.status?.powerState ||
      "UNKNOWN",
    isHidden: true,
    isControllerVm: true,
    isFsvm: false,
    categories: [],
    clusterUuid: clusterId,
    ipAddress: ip || undefined
  };
}

async function fetchClusterCvms(client) {
  const {
    ids: clusterIds,
    baseVersion,
    probeResults: clusterListProbe
  } = await listClusterIds(client);
  if (!clusterIds.length) {
    return { vms: [], probeResults: clusterListProbe };
  }

  const found = [];
  const probeResults = [...clusterListProbe];

  for (const clusterId of clusterIds) {
    const url = `/api/clustermgmt/${baseVersion}/config/clusters/${clusterId}/cvms?$limit=100`;
    try {
      const resp = await client.get(url, { timeout: 7000 });
      const entities = parseGenericEntityList(resp);
      probeResults.push({ url, ok: true, count: entities.length });
      if (entities.length && entities[0]) {
        const sampleKeys = Object.keys(entities[0]).join(",");
        const ipPreview = JSON.stringify(entities[0].ipAddress);
        console.log(
          `[cvm-probe] cluster=${clusterId} first entity keys: ${sampleKeys}`
        );
        console.log(
          `[cvm-probe] cluster=${clusterId} first entity name=${entities[0].name} ipAddress=${ipPreview}`
        );
      }
      entities
        .map((entity) => mapCvmEntityToVm(entity, clusterId))
        .filter(Boolean)
        .forEach((vm) => found.push(vm));
    } catch (error) {
      const data = error.response?.data;
      const errMsg =
        typeof data === "string"
          ? data.slice(0, 240)
          : data
            ? JSON.stringify(data).slice(0, 240)
            : error.message || "";
      probeResults.push({
        url,
        ok: false,
        status: error.response?.status || null,
        message: errMsg
      });
      // Skip retry-loop for PC clusters that explicitly reject CVM list (CLU-10006).
      if (typeof errMsg === "string" && errMsg.includes("CLU-10006")) {
        continue;
      }
    }
  }

  return {
    vms: Array.from(new Map(found.map((vm) => [vm.uuid, vm])).values()),
    probeResults
  };
}

function extractV4PageInfo(vmResponse) {
  const payload = vmResponse?.data?.data || vmResponse?.data || {};
  const metadata = payload?.metadata || vmResponse?.data?.metadata || {};
  const totalAvailableResults =
    Number(metadata?.totalAvailableResults) ||
    Number(metadata?.total_matches) ||
    Number(payload?.totalAvailableResults) ||
    Number(payload?.total_matches) ||
    0;
  const returned =
    Number(metadata?.returnedResults) ||
    Number(metadata?.returned_results) ||
    Number(payload?.returnedResults) ||
    Number(payload?.returned_results) ||
    0;
  return { totalAvailableResults, returned };
}

function formatAxiosError(error) {
  const status = error.response?.status || 500;
  const data = error.response?.data;
  const details =
    typeof data === "string"
      ? data
      : data
        ? JSON.stringify(data)
        : error.message;
  return { status, details };
}

function findFirstValueByKeys(input, keys) {
  if (input === null || input === undefined) {
    return undefined;
  }
  if (Array.isArray(input)) {
    for (const item of input) {
      const found = findFirstValueByKeys(item, keys);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  if (typeof input !== "object") {
    return undefined;
  }

  // Handle KV-pair style objects: { name: "WsUri", value: "/console/launch/..." }.
  if (
    typeof input.name === "string" &&
    keys.has(input.name) &&
    input.value !== undefined &&
    input.value !== null &&
    input.value !== ""
  ) {
    return input.value;
  }

  for (const [k, v] of Object.entries(input)) {
    if (keys.has(k) && v !== undefined && v !== null && v !== "") {
      return v;
    }
    const found = findFirstValueByKeys(v, keys);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

function extractTaskErrorDetails(taskData) {
  if (!taskData || typeof taskData !== "object") {
    return "";
  }
  const messages = [];
  const seen = new Set();

  const visit = (node) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node.message === "string" && node.message.trim()) {
      const code = node.code ? ` [${node.code}]` : "";
      messages.push(`${node.message.trim()}${code}`);
    }
    if (
      typeof node.errorMessage === "string" &&
      node.errorMessage.trim() &&
      !messages.includes(node.errorMessage.trim())
    ) {
      messages.push(node.errorMessage.trim());
    }
    if (
      typeof node.errorDetail === "string" &&
      node.errorDetail.trim() &&
      !messages.includes(node.errorDetail.trim())
    ) {
      messages.push(node.errorDetail.trim());
    }
    Object.values(node).forEach(visit);
  };
  visit(taskData);

  const unique = Array.from(new Set(messages));
  return unique.slice(0, 3).join(" | ");
}

async function startConsoleTokenTask(client, vmUuid) {
  const candidates = [
    `/api/vmm/v4.2/ahv/config/vms/${vmUuid}/$actions/generate-console-token`,
    `/api/vmm/v4.1/ahv/config/vms/${vmUuid}/$actions/generate-console-token`,
    `/api/vmm/v4.0/ahv/config/vms/${vmUuid}/$actions/generate-console-token`,
    `/api/vmm/v4.2/ahv/config/vms/${vmUuid}/$actions/generate-vm-console-token`,
    `/api/vmm/v4.1/ahv/config/vms/${vmUuid}/$actions/generate-vm-console-token`,
    `/api/vmm/v4.0/ahv/config/vms/${vmUuid}/$actions/generate-vm-console-token`
  ];

  let lastError = null;
  for (const url of candidates) {
    try {
      // Prism expects a POST with no request body for this action.
      const resp = await client.request({
        method: "post",
        url,
        headers: {
          "Content-Type": undefined
        },
        data: undefined
      });
      return { resp, usedUrl: url };
    } catch (error) {
      const details = error.response?.data || error.message;
      const messageText =
        typeof details === "string" ? details : JSON.stringify(details);
      // Move to next candidate only for path/endpoint compatibility failures.
      if (
        error.response?.status === 400 &&
        messageText.toLowerCase().includes("no api path found")
      ) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error("No supported console-token endpoint found.");
}

function buildVmListUrl(pageSize, offset, variant = "") {
  const base = `/api/vmm/v4.0/ahv/config/vms?$limit=${pageSize}&$page=${offset}`;
  return variant ? `${base}&${variant}` : base;
}

function getVmListVariants(includeHiddenVms) {
  if (!includeHiddenVms) {
    return [""];
  }
  return [
    "$includeHidden=true",
    "$includeSystemVms=true",
    "$includeInternal=true",
    "$includeInternalVms=true",
    "$includeControllerVms=true",
    "$includeControllerVMs=true",
    "$includeCvm=true",
    "$includeCVM=true",
    "includeInternal=true",
    "includeInternalVms=true",
    "includeControllerVms=true",
    "includeControllerVMs=true",
    "includeCvm=true",
    "includeCVM=true",
    "$includeHidden=true&$includeSystemVms=true",
    "$includeHidden=true&$includeControllerVms=true",
    "$includeInternal=true&$includeControllerVms=true",
    ""
  ];
}

async function selectVmListVariant(client, pageSize, includeHiddenVms) {
  const cacheKey = `${client.defaults.baseURL}|${includeHiddenVms ? "hidden" : "default"}`;
  const cachedVariant = vmListVariantCache.get(cacheKey);
  if (cachedVariant !== undefined) {
    const cachedResp = await client.get(buildVmListUrl(pageSize, 0, cachedVariant), {
      timeout: PRISM_HTTP_TIMEOUT_MS
    });
    return { variant: cachedVariant, firstResponse: cachedResp, score: 0 };
  }

  const variants = getVmListVariants(includeHiddenVms);
  const settled = await Promise.allSettled(
    variants.map(async (variant) => {
      const resp = await client.get(buildVmListUrl(pageSize, 0, variant), {
        timeout: PRISM_HTTP_TIMEOUT_MS
      });
      const parsed = parseVmList(resp);
      const hiddenCount = parsed.filter(
        (vm) => vm.isHidden || vm.isControllerVm
      ).length;
      const score = hiddenCount * 1000 + parsed.length;
      return { variant, firstResponse: resp, score };
    })
  );

  let best = null;
  const failureReasons = [];
  for (const item of settled) {
    if (item.status === "fulfilled") {
      if (!best || item.value.score > best.score) {
        best = item.value;
      }
    } else if (item.reason) {
      const reason = item.reason;
      const status = reason.response?.status;
      const data = reason.response?.data;
      const detail =
        typeof data === "string"
          ? data.slice(0, 160)
          : data
            ? JSON.stringify(data).slice(0, 160)
            : reason.message || String(reason);
      failureReasons.push(
        `${reason.config?.url || "?"} -> ${status ?? "no-response"} ${detail}`
      );
    }
  }

  if (!best) {
    const unique = Array.from(new Set(failureReasons)).slice(0, 5);
    const summary = unique.length
      ? `All ${variants.length} VM-list probes failed against ${client.defaults.baseURL}:\n  - ${unique.join(
          "\n  - "
        )}`
      : `All ${variants.length} VM-list probes failed against ${client.defaults.baseURL} with no response.`;
    const err = new Error(summary);
    err.allProbesFailed = true;
    throw err;
  }
  vmListVariantCache.set(cacheKey, best.variant);
  return best;
}

async function fetchCvmFocusedPage(client, pageSize, offset) {
  const filterVariants = [
    "$filter=isControllerVm eq true",
    "$filter=isSystemVm eq true",
    "$filter=contains(name,'CVM')",
    "$filter=contains(name,'NTNX')"
  ];
  const results = [];
  await Promise.allSettled(
    filterVariants.map(async (filter) => {
      const url = `/api/vmm/v4.0/ahv/config/vms?$limit=${pageSize}&$page=${offset}&${filter}`;
      const resp = await client.get(url, { timeout: PRISM_HTTP_TIMEOUT_MS });
      results.push(...parseVmList(resp));
    })
  );
  return Array.from(new Map(results.map((vm) => [vm.uuid, vm])).values());
}

app.post("/api/vms", async (req, res) => {
  try {
    const { pcHost, username, password, tlsSkipVerify, includeHiddenVms } =
      resolveAuth(req.body);
    if (!pcHost || !username || !password) {
      return res.status(400).json({
        error:
          "pcHost, username, and password are required (request body or .env fallback)."
      });
    }
    const client = createPrismClient(pcHost, username, password, tlsSkipVerify);
    const pageSize = 100;
    let offset = 0;
    let total = 0;
    const allVms = [];
    const selected = await selectVmListVariant(
      client,
      pageSize,
      includeHiddenVms
    );
    const selectedVariant = selected.variant;

    for (let i = 0; i < 20; i += 1) {
      const vmResp =
        i === 0
          ? selected.firstResponse
          : await client.get(
              buildVmListUrl(pageSize, offset, selectedVariant),
              { timeout: PRISM_HTTP_TIMEOUT_MS }
            );
      const regularPage = parseVmList(vmResp);
      const cvmFocusedPage = includeHiddenVms
        ? await fetchCvmFocusedPage(client, pageSize, offset)
        : [];
      const pageVms = Array.from(
        new Map(
          [...regularPage, ...cvmFocusedPage].map((vm) => [vm.uuid, vm])
        ).values()
      );
      allVms.push(...pageVms);

      const pageInfo = extractV4PageInfo(vmResp);
      if (pageInfo.totalAvailableResults > 0) {
        total = pageInfo.totalAvailableResults;
      } else if (!total) {
        total = allVms.length;
      }

      if (pageVms.length < pageSize || allVms.length >= total) {
        break;
      }
      offset += pageSize;
    }

    let deduped = Array.from(
      new Map(allVms.map((vm) => [vm.uuid, vm])).values()
    ).sort((a, b) => a.name.localeCompare(b.name));
    if (includeHiddenVms) {
      const controllerProbe = await fetchControllerVmCandidates(client);
      const cvmFromControllerEndpoints = controllerProbe.vms;
      if (cvmFromControllerEndpoints.length) {
        cvmFromControllerEndpoints.forEach((vm) => {
          if (!deduped.find((existing) => existing.uuid === vm.uuid)) {
            deduped.push(vm);
          }
        });
        deduped.sort((a, b) => a.name.localeCompare(b.name));
      }

      const clusterCvmProbe = await fetchClusterCvms(client);
      const clusterIpCache = new Map();
      const resolveClusterIp = async (clusterExtId) => {
        if (!clusterExtId) return "";
        if (clusterIpCache.has(clusterExtId)) {
          return clusterIpCache.get(clusterExtId);
        }
        const ip = await fetchClusterExternalAddress(client, clusterExtId);
        clusterIpCache.set(clusterExtId, ip);
        return ip;
      };

      if (clusterCvmProbe.vms.length) {
        // Build IP/name lookup against the AHV VM list so we can re-key each
        // CVM to its AHV VM UUID. The clustermgmt extId is a CVM-domain
        // identifier and is rejected by VMM with VMM-30100.
        const byIp = new Map();
        const byName = new Map();
        for (const vm of deduped) {
          (vm.ipAddresses || []).forEach((ip) => {
            if (ip && !byIp.has(ip)) byIp.set(ip, vm);
          });
          if (vm.name) byName.set(vm.name.toLowerCase(), vm);
        }

        const unmatchedCvms = [];
        clusterCvmProbe.vms.forEach((cvm) => {
          let ahvMatch = null;
          if (cvm.ipAddress && byIp.has(cvm.ipAddress)) {
            ahvMatch = byIp.get(cvm.ipAddress);
          }
          if (!ahvMatch && cvm.name) {
            ahvMatch = byName.get(cvm.name.toLowerCase());
          }

          if (ahvMatch) {
            ahvMatch.isControllerVm = true;
            ahvMatch.isHidden = true;
            ahvMatch.clusterUuid = cvm.clusterUuid || ahvMatch.clusterUuid;
            ahvMatch.cvmExtId = cvm.uuid;
            if (cvm.ipAddress && !ahvMatch.ipAddress) {
              ahvMatch.ipAddress = cvm.ipAddress;
            }
            if (cvm.name && !/cvm/i.test(ahvMatch.name)) {
              ahvMatch.name = cvm.name;
            }
            return;
          }
          unmatchedCvms.push(cvm);
        });

        // Resolve PE external IP per cluster for unmatched CVMs so the
        // console-token call can be redirected to the cluster's PE.
        const peLookups = await Promise.all(
          unmatchedCvms.map(async (cvm) => ({
            cvm,
            peHost: await resolveClusterIp(cvm.clusterUuid)
          }))
        );
        peLookups.forEach(({ cvm, peHost }) => {
          deduped.push({
            ...cvm,
            peHost: peHost || undefined,
            cvmIp: cvm.ipAddress,
            cvmName: cvm.name,
            consoleSupported: Boolean(peHost)
          });
        });
        deduped.sort((a, b) => a.name.localeCompare(b.name));
      }

      const cvmCount = deduped.filter((vm) => vm.isControllerVm).length;
      if (cvmCount === 0) {
        console.error(
          "CVM lookup yielded none. Probe summary:",
          JSON.stringify([
            ...controllerProbe.probeResults,
            ...clusterCvmProbe.probeResults
          ])
        );
      }
      if (cvmCount === 0) {
        // Fallback: list through Prism session-cookie context (can differ from basic auth view).
        const sessionCookie = await createPrismSessionCookie(
          client,
          username,
          password
        );
        if (sessionCookie) {
          const cookieClient = createCookieClient(pcHost, sessionCookie, tlsSkipVerify);
          try {
            const cookieResp = await cookieClient.get(
              buildVmListUrl(pageSize, 0, selectedVariant),
              { timeout: 7000 }
            );
            const cookieVms = parseVmList(cookieResp);
            deduped = Array.from(
              new Map([...deduped, ...cookieVms].map((vm) => [vm.uuid, vm])).values()
            ).sort((a, b) => a.name.localeCompare(b.name));
          } catch (_cookieError) {
            // Ignore; diagnostics already included below.
          }
        }
      }
      return res.json({
        vms: deduped,
        count: deduped.length,
        hiddenCount: deduped.filter((vm) => vm.isHidden || vm.isControllerVm).length,
        cvmCount: deduped.filter((vm) => vm.isControllerVm).length,
        fsvmCount: deduped.filter((vm) => vm.isFsvm).length,
        listVariant: selectedVariant || "default",
        cvmProbeSummary: [
          ...controllerProbe.probeResults,
          ...clusterCvmProbe.probeResults
        ]
      });
    }
    return res.json({
      vms: deduped,
      count: deduped.length,
      hiddenCount: deduped.filter((vm) => vm.isHidden || vm.isControllerVm).length,
      cvmCount: deduped.filter((vm) => vm.isControllerVm).length,
      fsvmCount: deduped.filter((vm) => vm.isFsvm).length,
      listVariant: selectedVariant || "default"
    });
  } catch (error) {
    const { status, details } = formatAxiosError(error);
    console.error("VM list failed:", details);
    return res.status(status).json({
      error: "Failed to list VMs.",
      details
    });
  }
});

// Lightweight credential probe used by the login screen so the user
// gets into the app shell within a second or two, instead of waiting
// for the full multi-cluster VM list to come back from /api/vms.
app.post("/api/pc-test", async (req, res) => {
  try {
    const { pcHost, username, password, tlsSkipVerify } = resolveAuth(req.body);
    if (!pcHost || !username || !password) {
      return res
        .status(400)
        .json({ ok: false, error: "pcHost, username, and password are required." });
    }
    const client = createPrismClient(pcHost, username, password, tlsSkipVerify);
    // A handful of fast probes, tried in parallel: whichever returns
    // first (with auth-acceptance) wins. We bound each at 6 s so a
    // misbehaving endpoint can't drag the whole login down.
    const probeTimeoutMs = 6000;
    const probes = [
      () => client.get("/api/clustermgmt/v4.0/config/clusters?$limit=1", { timeout: probeTimeoutMs }),
      () => client.get("/api/clustermgmt/v4.1/config/clusters?$limit=1", { timeout: probeTimeoutMs }),
      () => client.get("/PrismGateway/services/rest/v2.0/cluster", { timeout: probeTimeoutMs }),
      () =>
        client.post(
          "/api/nutanix/v3/clusters/list",
          { kind: "cluster", length: 1 },
          { timeout: probeTimeoutMs }
        )
    ];
    let sawAuthFailure = false;
    let lastDetail = "";
    const tryProbe = (fn) =>
      fn().then(
        (resp) => ({ ok: true, status: resp.status }),
        (error) => {
          const status = error.response?.status || null;
          if (status === 401) sawAuthFailure = true;
          const data = error.response?.data;
          const text =
            typeof data === "string"
              ? data
              : data
                ? JSON.stringify(data)
                : error.message || "";
          lastDetail = text.slice(0, 200);
          return { ok: false, status, message: lastDetail };
        }
      );

    // Promise.any resolves on the first fulfilled probe whose result is
    // ok. We wrap each probe in an inversion so non-ok results reject,
    // letting Promise.any short-circuit on the first true success.
    const inverted = probes.map((fn) =>
      tryProbe(fn).then((r) => (r.ok ? r : Promise.reject(r)))
    );
    try {
      const winner = await Promise.any(inverted);
      return res.json({ ok: true, status: winner.status });
    } catch (_aggregate) {
      if (sawAuthFailure) {
        return res.status(401).json({
          ok: false,
          error: "Prism Central rejected those credentials (401).",
          details: lastDetail || undefined
        });
      }
      return res.status(502).json({
        ok: false,
        error: `Prism Central at ${pcHost} did not respond to any probe.`,
        details: lastDetail || undefined
      });
    }
  } catch (error) {
    const { status, details } = formatAxiosError(error);
    res.status(status).json({ ok: false, error: "PC test failed.", details });
  }
});

app.post("/api/pe-test", async (req, res) => {
  const peHost = (req.body.peHost || "").trim();
  const peUsername = (req.body.peUsername || "").trim();
  const pePassword = req.body.pePassword || "";
  const tlsSkipVerify = Boolean(req.body.tlsSkipVerify);

  if (!peHost || !peUsername || !pePassword) {
    return res
      .status(400)
      .json({ ok: false, error: "peHost, peUsername, pePassword required." });
  }

  const client = createPrismClient(peHost, peUsername, pePassword, tlsSkipVerify);
  const probes = [
    { method: "GET", url: "/api/clustermgmt/v4.0/config/clusters?$limit=1" },
    { method: "GET", url: "/api/clustermgmt/v4.1/config/clusters?$limit=1" },
    { method: "GET", url: "/api/clustermgmt/v4.2/config/clusters?$limit=1" },
    { method: "GET", url: "/PrismGateway/services/rest/v2.0/cluster" },
    {
      method: "POST",
      url: "/api/nutanix/v3/clusters/list",
      body: { kind: "cluster", length: 1 }
    },
    { method: "GET", url: "/PrismGateway/services/rest/v1/cluster" }
  ];

  const trace = [];
  let sawAuthFailure = false;
  for (const probe of probes) {
    try {
      const resp =
        probe.method === "GET"
          ? await client.get(probe.url, { timeout: 7000 })
          : await client.post(probe.url, probe.body || {}, { timeout: 7000 });
      const entities = parseGenericEntityList(resp);
      trace.push({
        url: `${probe.method} ${probe.url}`,
        ok: true,
        status: resp.status,
        count: entities.length
      });
      console.log(
        `[pe-test] OK ${resp.status} ${probe.method} ${probe.url} count=${entities.length}`
      );
      // Cache the validated credentials in the server-side session map.
      // The browser is only told the host was authenticated; the credentials
      // themselves are never returned in the response.
      req.nrccSession.peCreds.set(peHost, { peUsername, pePassword });
      return res.json({
        ok: true,
        peHost,
        clustersSeen: entities.length,
        viaUrl: `${probe.method} ${probe.url}`,
        stored: true,
        trace
      });
    } catch (error) {
      const status = error.response?.status || null;
      const data = error.response?.data;
      const msg =
        (typeof data === "string"
          ? data
          : data
            ? JSON.stringify(data)
            : error.message || ""
        ).slice(0, 200);
      trace.push({
        url: `${probe.method} ${probe.url}`,
        ok: false,
        status,
        message: msg
      });
      console.log(
        `[pe-test] ERR ${status ?? ""} ${probe.method} ${probe.url} :: ${msg}`
      );
      if (status === 401) sawAuthFailure = true;
    }
  }

  const detailLines = trace.map(
    (t) =>
      `  [${t.ok ? "OK" : "ERR"} ${t.status ?? ""}] ${t.url}${
        t.count !== undefined ? ` count=${t.count}` : ""
      }${t.message ? ` :: ${t.message.slice(0, 140)}` : ""}`
  );

  if (sawAuthFailure) {
    return res.status(401).json({
      ok: false,
      error: "PE rejected those credentials (401).",
      peHost,
      details: detailLines.join("\n"),
      trace
    });
  }
  return res.status(502).json({
    ok: false,
    error: `PE at ${peHost} did not respond to any cluster probe.`,
    peHost,
    details: detailLines.join("\n"),
    trace
  });
});

app.post("/api/console-token", async (req, res) => {
  try {
    const { pcHost, username, password, tlsSkipVerify } = resolveAuth(req.body);
    let vmUuid = req.body.vmUuid;
    const peHost = (req.body.peHost || "").trim();
    const cvmIp = (req.body.cvmIp || "").trim();
    const cvmName = (req.body.cvmName || "").trim();

    if (!pcHost || !username || !password) {
      return res.status(400).json({
        error:
          "pcHost, username, and password are required (request body or .env fallback)."
      });
    }

    if (!vmUuid && !cvmIp && !cvmName) {
      return res
        .status(400)
        .json({ error: "vmUuid (or cvmIp/cvmName) is required." });
    }

    const apiHost = peHost || pcHost;
    const usingPe = Boolean(peHost);
    let apiUsername = username;
    let apiPassword = password;
    if (usingPe) {
      // PE credentials are only ever read from the server-side session
      // cache. The client cannot pass them inline; it must authenticate
      // them once via /api/pe-test, which stores them under this session.
      const cached = req.nrccSession.peCreds.get(peHost);
      if (!cached) {
        return res.status(401).json({
          error: "PE credentials required.",
          details:
            `Prism Element at ${apiHost} requires its own credentials. ` +
            "Authenticate this PE once via /api/pe-test; NRCC will cache " +
            "the credentials in server memory for this session only.",
          needPeCredentials: true,
          peHost: apiHost
        });
      }
      apiUsername = cached.peUsername;
      apiPassword = cached.pePassword;
    }
    const client = createPrismClient(
      apiHost,
      apiUsername,
      apiPassword,
      tlsSkipVerify
    );

    if (usingPe) {
      const { uuid: resolvedUuid, diagnostics } =
        await resolveAhvVmUuidByIpOrName(client, cvmIp, cvmName);
      if (!resolvedUuid) {
        const sampleNames = (diagnostics.sampleNames || []).slice(0, 10);
        const probeLines = (diagnostics.triedUrls || [])
          .slice(0, 20)
          .map(
            (t) =>
              `[${t.ok ? "OK" : "ERR"} ${t.status ?? ""}] ${t.source ?? ""} ${t.url}${
                t.count !== undefined ? ` count=${t.count}` : ""
              }${t.message ? ` :: ${t.message.slice(0, 140)}` : ""}`
          );
        return res.status(404).json({
          error: "Could not locate the CVM on its Prism Element.",
          details:
            `PE host ${apiHost} did not return an AHV VM with ip='${cvmIp}' or name='${cvmName}'. ` +
            `Saw ${diagnostics.totalVmsSeen} VM(s). Sample names: ${sampleNames.join(", ") || "(none)"}.\n\n` +
            `Probe trace:\n${probeLines.join("\n")}`,
          diagnostics
        });
      }
      vmUuid = resolvedUuid;
    }

    if (!vmUuid) {
      return res.status(400).json({ error: "vmUuid is required." });
    }

    // PE branch: use legacy /vnc/vm/{uuid}/proxy WebSocket since v4 vmm
    // generate-console-token doesn't exist on this PE.
    if (usingPe) {
      const sessionCookie = await createPrismLegacySessionCookie(
        client,
        apiUsername,
        apiPassword
      );
      const targetUrl = `wss://${apiHost}:9440/vnc/vm/${vmUuid}/proxy`;
      const proxySessionId = crypto.randomUUID();
      wsProxySessions.set(proxySessionId, {
        targetUrl,
        tlsSkipVerify,
        sessionCookie,
        basicAuth: Buffer.from(`${apiUsername}:${apiPassword}`).toString(
          "base64"
        ),
        createdAtMs: Date.now()
      });
      const wsProtocol = req.protocol === "https" ? "wss" : "ws";
      const websocketUrl = `${wsProtocol}://${req.get("host")}/ws-proxy/${proxySessionId}`;
      return res.json({
        websocketUrl,
        via: `pe-legacy:${apiHost}`,
        targetUrl,
        note:
          "Connecting via Prism Element legacy VNC proxy (/vnc/vm/{uuid}/proxy). " +
          "Session cookie obtained from PrismGateway loginActions."
      });
    }

    const { resp: postResp, usedUrl } = await startConsoleTokenTask(client, vmUuid);
    const taskUuid =
      postResp.data?.data?.extId ||
      postResp.data?.data?.id ||
      postResp.data?.extId ||
      postResp.data?.id;

    if (!taskUuid) {
      return res.status(502).json({
        error: "Could not parse task UUID from generate-console-token response.",
        response: postResp.data
      });
    }

    const taskUrl = `/api/prism/v4.0/config/tasks/${taskUuid}`;

    let taskData = null;
    for (let i = 0; i < 20; i += 1) {
      const taskResp = await client.get(taskUrl);
      taskData = taskResp.data?.data || taskResp.data;
      const status =
        taskData?.status ||
        taskData?.progressStatus ||
        taskData?.state ||
        "";

      if (String(status).toUpperCase().includes("SUCCEEDED")) {
        break;
      }

      if (String(status).toUpperCase().includes("FAILED")) {
        const taskDetails = extractTaskErrorDetails(taskData);
        return res.status(502).json({
          error: "Generate console token task failed.",
          details: taskDetails || undefined,
          task: taskData
        });
      }

      await new Promise((r) => setTimeout(r, 1000));
    }

    const wsKeys = new Set([
      "console_websocket_uri",
      "WsUri",
      "wsUri",
      "websocketUri",
      "webSocketUri",
      "consoleUri"
    ]);
    const tokenKeys = new Set([
      "console_token",
      "VmConsoleToken",
      "vmConsoleToken",
      "consoleToken",
      "token",
      "jwt"
    ]);

    const wsPath = findFirstValueByKeys(taskData, wsKeys);
    const vmConsoleToken = findFirstValueByKeys(taskData, tokenKeys);

    if (!wsPath || !vmConsoleToken) {
      console.error(
        "Console details missing in task payload:",
        JSON.stringify(taskData)
      );
      return res.status(502).json({
        error: "Task completed but console details were not found in payload.",
        task: taskData
      });
    }

    const cleanPath = wsPath.startsWith("/") ? wsPath : `/${wsPath}`;
    const targetUrl = `wss://${apiHost}:9440${cleanPath}?VmConsoleToken=${encodeURIComponent(
      vmConsoleToken
    )}`;
    const sessionCookie = await createPrismSessionCookie(
      client,
      apiUsername,
      apiPassword
    );
    const proxySessionId = crypto.randomUUID();
    wsProxySessions.set(proxySessionId, {
      targetUrl,
      tlsSkipVerify,
      sessionCookie,
      basicAuth: Buffer.from(`${apiUsername}:${apiPassword}`).toString("base64"),
      createdAtMs: Date.now()
    });
    const wsProtocol = req.protocol === "https" ? "wss" : "ws";
    const websocketUrl = `${wsProtocol}://${req.get("host")}/ws-proxy/${proxySessionId}`;

    res.json({
      websocketUrl,
      vmConsoleToken,
      tokenApiPath: usedUrl,
      via: usingPe ? `pe:${apiHost}` : `pc:${apiHost}`,
      note: usingPe
        ? "Token generated against Prism Element (CVM is not visible to PC)."
        : "Browser must already have a valid Prism session cookie for this host."
    });
  } catch (error) {
    const { status, details } = formatAxiosError(error);
    console.error("Console token failed:", details);
    res.status(status).json({
      error: "Failed to generate console token.",
      details
    });
  }
});

// ---------------------------------------------------------------------
// Power actions (Power On / Power Off) for AHV VMs managed by Prism
// Central. CVMs are intentionally not supported here — they're managed
// by the cluster's own genesis service and shouldn't be power-cycled
// from a generic console launcher.
// ---------------------------------------------------------------------

async function getVmEntityEtag(client, vmUuid) {
  const candidates = [
    `/api/vmm/v4.0/ahv/config/vms/${vmUuid}`,
    `/api/vmm/v4.1/ahv/config/vms/${vmUuid}`,
    `/api/vmm/v4.2/ahv/config/vms/${vmUuid}`
  ];
  for (const url of candidates) {
    try {
      const resp = await client.get(url);
      // Axios normalizes header names to lowercase, but some Prism
      // responses also expose the entity ETag in the body as a
      // `$reserved`/`metadata` field. Prefer the HTTP ETag header.
      const etag =
        resp.headers?.etag ||
        resp.headers?.ETag ||
        resp.data?.data?.$reserved?.["ETag"] ||
        resp.data?.data?.metadata?.entityVersion ||
        null;
      if (etag) {
        console.log(`[vm-power] got etag from ${url}: ${etag}`);
        return etag;
      }
      // GET worked but no ETag was returned -- try the next API version.
    } catch (_error) {
      /* try next */
    }
  }
  return null;
}

async function postVmAction(client, url, ifMatchEtag) {
  // Mirror the pattern that startConsoleTokenTask uses: no body, no
  // Content-Type. Some Prism builds reject `{}` here with `INTERNAL_ERROR`
  // or `Bad Request` because they don't expect a body for $action POSTs.
  const headers = { "Content-Type": undefined };
  if (ifMatchEtag) headers["If-Match"] = ifMatchEtag;
  return client.request({
    method: "post",
    url,
    headers,
    data: undefined
  });
}

function isEtagRequiredError(status, messageText) {
  // Different Prism builds signal "I need an If-Match header" in
  // wildly different ways:
  //   - HTTP 412 Precondition Failed (textbook)
  //   - HTTP 428 Precondition Required (textbook)
  //   - HTTP 400 with code VMM-30300 / errorGroup VM_ETAG_MISSING / wording
  //     mentioning "If-Match" or "ETag"
  if (status === 412 || status === 428) return true;
  if (status === 400) {
    const t = (messageText || "").toLowerCase();
    if (
      t.includes("vmm-30300") ||
      t.includes("vm_etag_missing") ||
      t.includes("etag_missing") ||
      t.includes("if-match") ||
      t.includes("if_match") ||
      t.includes("missing etag")
    ) {
      return true;
    }
  }
  return false;
}

async function setVmPowerAction(client, vmUuid, action) {
  // action: 'on' | 'off' (force power-off; not graceful shutdown).
  const variants = [
    `/api/vmm/v4.2/ahv/config/vms/${vmUuid}/$actions/power-${action}`,
    `/api/vmm/v4.1/ahv/config/vms/${vmUuid}/$actions/power-${action}`,
    `/api/vmm/v4.0/ahv/config/vms/${vmUuid}/$actions/power-${action}`
  ];
  let etag = null;
  let lastError = null;
  for (const url of variants) {
    try {
      const resp = await postVmAction(client, url, etag);
      return { resp, usedUrl: url };
    } catch (error) {
      const status = error.response?.status;
      const data = error.response?.data;
      const messageText =
        typeof data === "string"
          ? data
          : data
            ? JSON.stringify(data)
            : error.message || "";
      console.warn(
        `[vm-power] ${action} attempt ${url} -> ${status ?? "?"} ${messageText.slice(0, 200)}`
      );
      // Endpoint not present on this PC version: move to next candidate.
      // (Be careful: a 400 that's about a missing ETag is NOT "no api path".)
      if (
        status === 400 &&
        messageText.toLowerCase().includes("no api path") &&
        !isEtagRequiredError(status, messageText)
      ) {
        lastError = error;
        continue;
      }
      // ETag required: fetch the entity ETag and retry the same URL.
      if (isEtagRequiredError(status, messageText) && !etag) {
        const fresh = await getVmEntityEtag(client, vmUuid).catch(() => null);
        if (fresh) {
          etag = fresh;
          try {
            const resp2 = await postVmAction(client, url, etag);
            return { resp: resp2, usedUrl: url };
          } catch (retryErr) {
            const retryStatus = retryErr.response?.status;
            const retryData = retryErr.response?.data;
            const retryMsg =
              typeof retryData === "string"
                ? retryData
                : retryData
                  ? JSON.stringify(retryData)
                  : retryErr.message || "";
            console.warn(
              `[vm-power] ${action} retry-with-etag ${url} -> ${retryStatus ?? "?"} ${retryMsg.slice(0, 200)}`
            );
            // If the retry says the endpoint isn't here, fall through to
            // the next variant. Otherwise propagate the error so the
            // user sees the real reason.
            if (
              retryStatus === 400 &&
              retryMsg.toLowerCase().includes("no api path")
            ) {
              lastError = retryErr;
              continue;
            }
            throw retryErr;
          }
        }
        // Couldn't get an ETag at all -- bail out with the original error.
        throw error;
      }
      throw error;
    }
  }
  throw lastError || new Error(`No supported power-${action} endpoint found.`);
}

app.post("/api/vm-power", async (req, res) => {
  try {
    const { pcHost, username, password, tlsSkipVerify } = resolveAuth(req.body);
    const vmUuid = (req.body.vmUuid || "").trim();
    const action = String(req.body.action || "").toLowerCase();
    const peHost = (req.body.peHost || "").trim();

    if (!pcHost || !username || !password) {
      return res.status(400).json({
        error:
          "pcHost, username, and password are required (request body or .env fallback)."
      });
    }
    if (!vmUuid) {
      return res.status(400).json({ error: "vmUuid is required." });
    }
    if (action !== "on" && action !== "off") {
      return res
        .status(400)
        .json({ error: "action must be 'on' or 'off'." });
    }
    if (peHost) {
      // CVMs are stamped with peHost; refuse to power-cycle them from here.
      return res.status(400).json({
        error: "Power on/off is not available for CVMs through NRCC.",
        details:
          "Controller VMs are managed by the cluster's genesis service. " +
          "Use cluster-level tools (genesis stop / cluster start) instead."
      });
    }

    const client = createPrismClient(pcHost, username, password, tlsSkipVerify);
    const { resp, usedUrl } = await setVmPowerAction(client, vmUuid, action);

    const taskUuid =
      resp.data?.data?.extId ||
      resp.data?.data?.id ||
      resp.data?.extId ||
      resp.data?.id;

    if (!taskUuid) {
      return res.json({
        ok: true,
        status: "submitted",
        via: usedUrl,
        action
      });
    }

    const taskUrl = `/api/prism/v4.0/config/tasks/${taskUuid}`;
    let taskData = null;
    for (let i = 0; i < 12; i += 1) {
      const taskResp = await client.get(taskUrl);
      taskData = taskResp.data?.data || taskResp.data;
      const taskStatus =
        taskData?.status ||
        taskData?.progressStatus ||
        taskData?.state ||
        "";

      if (String(taskStatus).toUpperCase().includes("SUCCEEDED")) {
        return res.json({
          ok: true,
          status: "succeeded",
          via: usedUrl,
          action,
          task: { uuid: taskUuid, status: taskStatus }
        });
      }
      if (String(taskStatus).toUpperCase().includes("FAILED")) {
        const taskDetails = extractTaskErrorDetails(taskData);
        return res.status(502).json({
          error: `Power-${action} task failed.`,
          details: taskDetails || undefined,
          task: taskData
        });
      }
      await new Promise((r) => setTimeout(r, 800));
    }
    return res.json({
      ok: true,
      status: "pending",
      via: usedUrl,
      action,
      task: { uuid: taskUuid }
    });
  } catch (error) {
    const { status, details } = formatAxiosError(error);
    console.error("VM power action failed:", details);
    res.status(status).json({
      error: "Failed to change VM power state.",
      details
    });
  }
});

const server = http.createServer(app);
const wsServer = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const requestUrl = new URL(req.url, "http://localhost");
  if (!requestUrl.pathname.startsWith("/ws-proxy/")) {
    socket.destroy();
    return;
  }
  wsServer.handleUpgrade(req, socket, head, (ws) => {
    wsServer.emit("connection", ws, req, requestUrl);
  });
});

wsServer.on("connection", (clientSocket, req, requestUrl) => {
  const sessionId = requestUrl.pathname.replace("/ws-proxy/", "");
  const session = wsProxySessions.get(sessionId);
  if (!session) {
    clientSocket.close(1011, "Session not found");
    return;
  }

  if (Date.now() - session.createdAtMs > 10 * 60 * 1000) {
    wsProxySessions.delete(sessionId);
    clientSocket.close(1011, "Session expired");
    return;
  }

  const headers = {
    "NTNX-Request-Id": crypto.randomUUID(),
    "X-Request-Id": crypto.randomUUID()
  };
  if (session.sessionCookie) {
    headers.Cookie = session.sessionCookie;
  } else {
    headers.Authorization = `Basic ${session.basicAuth}`;
  }

  const upstream = new WebSocket(session.targetUrl, {
    rejectUnauthorized: !session.tlsSkipVerify,
    headers
  });

  const closeBoth = (code = 1000, reason = "closed") => {
    if (clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.close(code, reason);
    }
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.close(code, reason);
    }
  };

  upstream.on("open", () => {
    wsProxySessions.delete(sessionId);
  });
  upstream.on("message", (data) => {
    if (clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.send(data);
    }
  });
  clientSocket.on("message", (data) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data);
    }
  });

  upstream.on("close", (code, reason) => {
    if (clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.close(code, reason.toString());
    }
  });
  clientSocket.on("close", () => closeBoth());

  upstream.on("error", (error) => {
    console.error("Upstream console WS error:", error.message);
    closeBoth(1011, "Upstream error");
  });
  clientSocket.on("error", () => closeBoth(1011, "Client error"));
});

setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of wsProxySessions.entries()) {
    if (now - session.createdAtMs > 10 * 60 * 1000) {
      wsProxySessions.delete(sessionId);
    }
  }
  for (const [sid, session] of serverSessions.entries()) {
    if (now - session.lastSeenAtMs > SESSION_TTL_MS) {
      serverSessions.delete(sid);
    }
  }
}, 60 * 1000);

server.listen(port, () => {
  console.log(`Nutanix console launcher running at http://localhost:${port}`);
});
