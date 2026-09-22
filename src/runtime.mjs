import { randomUUID } from "node:crypto";
import { KaptureClient } from "./kapture-client.mjs";
import { TabLeaseManager } from "./lease.mjs";
import { jev } from "./jev.mjs";
import { config } from "./config.mjs";
import { FIELDISH, SELECTISH, brief, elementFingerprint, formatPage, pageDiff, repeatsBlock, toModelPage } from "./page-model.mjs";
import { log } from "./log.mjs";
import { normalizeTaskContract, contractForModel } from "./task-contract.mjs";
import { evaluateAssertions, verificationQuestions, summarizeVerification } from "./verification.mjs";
import { recoveryFor } from "./recovery.mjs";
import { normalizeMilestonePlan, milestoneForHost } from "./milestones.mjs";
import { verifyActionEffect } from "./action-effect.mjs";
import { buildEvidencePacket, evidenceRef, relevantRequest, sanitizeNetworkBody, summarizeRequest } from "./evidence.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function defaultSnapshotter(kapture, tabId) {
  const { semanticSnapshot } = await import("./semantic-snapshot.mjs");
  return semanticSnapshot(kapture, tabId);
}

const TOOLS = {
  click: "Click the target link, button, checkbox, radio, tab, menu item, or other control",
  type: "Replace the target text field content with one of task.values",
  press_enter: "Press Enter in the target field or control",
  press_key: "Press a keyboard key such as Escape, Tab, arrows, Space, Backspace, PageDown or PageUp",
  select: "Choose a native select option or open a combobox toward the goal",
  hover: "Hover a target to reveal hidden content",
  scroll: "Scroll down to reveal or load more content",
  wait: "Wait because the page is still loading or processing",
  none: "Do nothing because the goal is achieved or no available action can make progress",
};

const KEYS = ["Escape", "Tab", "Space", "Backspace", "Delete", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "PageDown", "PageUp", "Home", "End"];
const TARGETED = new Set(["click", "type", "press_enter", "select", "hover"]);
const GUARDED = new Set(["click", "press_enter", "press_key"]);
const SECRET_KEY = /(pass(word)?|secret|token|api[-_]?key|otp|2fa|pin|cvv|cvc|security[-_]?code)/i;

function sanitizedValues(values) {
  return Object.fromEntries(Object.entries(values || {}).map(([key, value]) => [
    key,
    SECRET_KEY.test(key) ? "[secret value available locally; contents hidden from Jev]" : String(value).slice(0, 160),
  ]));
}

function actionError(error) {
  const message = String(error?.message ?? error);
  if (/not found|no element|selector/i.test(message)) return "target is no longer present";
  if (/dialog/i.test(message)) return "a browser dialog is blocking the page";
  return message.split("\n")[0].slice(0, 220);
}


function navigationLike(action) {
  if (!action) return false;
  if (action.tool === "click") return action.tag === "a" || action.role === "link";
  if (action.tool === "press_enter") return ["textbox", "searchbox"].includes(action.role);
  return false;
}

export class JevSteerRuntime {
  constructor({ kapture = new KaptureClient(), leases = new TabLeaseManager(), decider = jev, snapshotter = defaultSnapshotter } = {}) {
    this.kapture = kapture;
    this.leases = leases;
    this.decider = decider;
    this.snapshotter = snapshotter;
    this.activeTabId = null;
    this.shown = null;
    this.stats = { calls: 0, jev_ms: 0, tokens: 0 };
    this.evidenceStore = new Map();
  }

  getEvidence(ref) {
    const value = this.evidenceStore.get(ref);
    if (!value) throw new Error(`EVIDENCE_NOT_FOUND: ${ref}`);
    return value;
  }

  storeEvidence(ref, value) {
    this.evidenceStore.set(ref, value);
    while (this.evidenceStore.size > 500) this.evidenceStore.delete(this.evidenceStore.keys().next().value);
  }

  async startNetworkCapture(tabId, runId, milestoneId, level) {
    if (level === "none") return { available: false, disabled: true };
    const clientId = `jevsteer-${runId}-${milestoneId}`;
    try {
      await this.kapture.command(tabId, "network_monitor", { enabled: true, clientId });
      const baseline = await this.kapture.command(tabId, "network_requests", { since: 0, limit: 1000 }).catch(() => ({}));
      return { available: true, clientId, cursor: Number(baseline?.cursor || 0) };
    } catch (error) {
      return { available: false, error: actionError(error) };
    }
  }

  async finishNetworkCapture(tabId, capture, runId, milestoneId, level) {
    if (!capture?.available) return capture || { available: false };
    try {
      const listed = await this.kapture.command(tabId, "network_requests", { since: capture.cursor || 0, limit: 1000 });
      const requests = Array.isArray(listed?.requests) ? listed.requests : [];
      const relevant = requests.filter(relevantRequest).slice(-20);
      const summaries = [];
      for (const request of relevant) {
        let body;
        let ref;
        if (level === "relevant" && request?.requestId) {
          try {
            body = await this.kapture.command(tabId, "network_body", { requestId: request.requestId, maxBytes: 16384 });
            ref = evidenceRef(runId, milestoneId, request.requestId);
            this.storeEvidence(ref, {
              request: { method: request.method, url: request.url, status: request.status, type: request.type },
              ...sanitizeNetworkBody(body),
            });
          } catch {}
        }
        summaries.push(summarizeRequest(request, body, ref));
      }
      return {
        available: true,
        total_requests: requests.length,
        relevant_requests: relevant.length,
        requests: summaries,
      };
    } catch (error) {
      return { available: false, error: actionError(error) };
    } finally {
      await this.kapture.command(tabId, "network_monitor", { enabled: false, clientId: capture.clientId }).catch(() => {});
    }
  }

  async close() {
    await this.kapture.close();
  }

  async ensureReady() {
    return this.kapture.ensureServer();
  }

  async tabs() {
    await this.ensureReady();
    const tabs = await this.kapture.listTabs();
    return Promise.all(tabs.map(async (tab) => ({
      tab_id: tab.tabId,
      title: tab.title,
      url: tab.url,
      browser: tab.browser,
      extension_version: tab.version,
      visible: tab.pageVisibility?.visible,
      eval_allowed: tab.evalAllowed,
      lease: await this.leases.inspect(tab.tabId),
    })));
  }

  async doctor() {
    let server;
    try { server = await this.ensureReady(); } catch (error) {
      return {
        status: "not_ready",
        typesafe_key: !!process.env.TYPESAFE_API_KEY,
        kapture_server: false,
        error: String(error?.message ?? error),
      };
    }
    const tabs = await this.tabs();
    return {
      status: process.env.TYPESAFE_API_KEY && tabs.length ? "ready" : "needs_setup",
      typesafe_key: !!process.env.TYPESAFE_API_KEY,
      jev_model: config.jevModel,
      kapture_server: true,
      kapture_mode: server.mode,
      kapture_port: server.port,
      connected_tabs: tabs.length,
      tabs,
      next_step: !process.env.TYPESAFE_API_KEY
        ? "Set TYPESAFE_API_KEY for this MCP server."
        : tabs.length === 0
          ? "Install/enable the Kapture browser extension and click its toolbar icon in the tab you want the agent to control."
          : "Ready for browser_run.",
    };
  }

  async selectTab(tabId) {
    const tabs = await this.kapture.listTabs();
    if (taD,ІH†@LѓЌЋВ€Y€
\њ›ЬЉHВ€™\њ›Ь€HXЭ[Ы‘\њ›ЬЉ\њ›ЬЉNВ€›ЭЛXЭ[Ы—Щ\њ›Ь€H™\њ›ЬЋВ€ЩКXЭ[Ы€Z[Y‹™\њ›ЬЉNВ€B€B€\ЭЬћKњ\Ъ

NВ€™]љ[Э\ИHYЩNВ€\ЭXЭ[Ы€HXЭ[Ы”ЭXШЩYYYИВ€ЫЫ€XЭ[Ы‹ќЫЫ€[[Y[ќ€њљYYЉXЭ[Ы‹™[
K€[€XЭ[Ы‹™[€^XЭYЭ[YN€XЭ[Ы‹ќ[YK€ЪYWЩY™™XЭ€ЪYQY™™XЭ€\њ™]™\њЪX›N€ќ[X™\Љ[њЭЩ\‹љ\њ™]™\њЪX›K››Э[
K€™Y›Ь™WЭ\›€YЩKќ\›€YО€XЭ[Ы‹™[ЛќYЛ€›ЫN€XЭ[Ы‹™[Лњ›ЫK€H€ќ[В€B‚€\ЛњЪЭЫ€HYЩHИИ‹‹њYЩKX—ЪY€X‹ќX’YH€ќ[В€ЫЫњЭЭ]]HВ€Э]\Л€\ЪО€ЫЫќXЭ€X—ЪY€X‹ќX’Y€\›€YЩOЛќ\›€]N€YЩOЛќ]K€XЭ[ЫњО€\ЭЬћK€Ы™WЬШЫЬ™N€ќ[X™\Љ
›Э[™Л]
LJOЛ™Ы™H
KќСљ^Y
ЉJK€Ы—ЭXЪЧЬШЫЬ™N€ќ[X™\Љ
›Э[™Л]
LJOЛ›Ы—ЭXЪИПИJKќСљ^Y
ЉJK€]]ЧЬ™XЫЭ™\љY\О€]]Ф™XЫЭ™\љY\Л€™]—ШШ[О€\ЛњЭ]ЛШ[ИHШ[М€™]—Ъ[њ]ЭЪЩ[њО€\ЛњЭ]ЛќЪЩ[њИHЪЩ[њМ€\О€]K››ЭК
HHЭ\ќY€NВ€Y€
™\љYљXШ][ЫЉHЭ]]ќ™\љYљXШ][Ы€H™\љYљXШ][ЫЋВ€Y€
[™›КHЭ]]љ[™›ИH[™›ОВ€Y€
[™[™КHЭ]]њ[™[™ИH[™[™ОВ€Y€
Э]\ИOOHЫЫ\]YЭ™\љYљYYЉHВ€Э]]њYЩWЭ^HYЩOЛќ^ЛњЫXЩJМ
NВ€Y€
И[XљYЭ[Э\И‹›™YYЧЩЭZY[ЩH‹њЭXЪИ‹›X^ШXЭ[ЫњИ‹™љYќY‹ќ™\љYљXШ][Ы—ЩZ[Y‹ќ™\љYљXШ][Ы—Э[Щ\ќZ[€—Kљ[ЫY\КЭ]\КJHВ€Э]]Ш[™Y]\ИH›Э[™Л]
LJOЛШ[™Y]\ОВ€B€ЫЫњЭZ[YЭ\H\ЭЬћK™љ[\Љ

HO€XЭ[ЫЉK]
LJNВ€ЫЫњЭ™XЫЭ™\ћHH™XЫЭ™\ћQ›ЬЉЭ]\ЛВ€X’Y€X‹ќX’Y€ЫЫќXЭ€ЪXЪЬЪ[ќ€\ЭЫЫЩЪXЪЬЪ[ќ€Z[YЭ\€Ш[™Y]\О€Э]]Ш[™Y]\Л€[™›Л€JNВ€Y€
™XЫЭ™\ћJHЭ]]њ™XЫЭ™\ћHH™XЫЭ™\ћNВ€B€Y€
^Z[ЉHЭ]]њ›Э[™ИH›Э[™ОВ€™]\›€Э]]В€JNВ€B‚€\Ю[Иќ[ЉЫШ[Ь[ЫњИHЯJHВ€ЫЫњЭВ€Z[\ЭЫ™\ИHЧK€™]љY]У[ЩHH™\Э‹€Z[\ЭЫ™R[™^H€ќ[’YH[™ЫUURQ

K€]љY[ЩS]™[Hњ™[][ќ‹€ЭZY[ЩHHЧK€‹‹њЪ[™ЫSЬ[ЫњВ€HHЬ[ЫњОВ€ЫЫњЭ[€H›Ь›X[^™SZ[\ЭЫ™T[ЉВ€ЫШ[€Z[\ЭЫ™\Л€ЭXШЩ\ЬРЬљ]\љXN€Ъ[™ЫSЬ[ЫњЛњЭXШЩ\ЬРЬљ]\љXHЧK€ЫЫњЭZ[ќО€Ъ[™ЫSЬ[ЫњЛЫЫњЭZ[ќИЧK€ЭZY[ЩK€\ЬЩ\ќ[ЫњО€Ъ[™ЫSЬ[ЫњЛ\ЬЩ\ќ[ЫњИЧK€X^XЭ[ЫњО€Ъ[™ЫSЬ[ЫњЛ›X^XЭ[ЫњИL‹€JNВ€ЫЫњЭЭ\ќHќ[X™\ЉZ[\ЭЫ™R[™^
NВ€Y€
Sќ[X™\‹љ\Т[ќYЩ\ЉЭ\ќ
HЭ\ќЭ\ќЏH[‹›Z[\ЭЫ™\Л›[™Э
H›ЭИ™]И\њ›ЬЉS•ђSQУRSTХУ‘WТS‘V€	ЫZ[\ЭЫ™R[™^X
NВ€Y€
VИ™\Э‹њЭљXЭ—Kљ[ЫY\К™]љY]У[ЩJJH›ЭИ™]И\њ›ЬЉS•ђSQФ‘U’QUЧУSСN€	Ь™]љY]У[Щ_X
NВ€]XЋВ€ћHВ€X€H]ШZ]\ЛњЩ[XЭXЉЪ[™ЫSЬ[ЫњЛќX’Y
NВ€HШ]Ъ
\њ›ЬЉHВ€Y€
\њ›ЬЏЛЫЩHOOH•P—ФСSPХSУ—Ф‘TURT‘QЉH›ЭИ\њ›ЬЋВ€™]\›€В€Э]\О€›™YYЧЭX—ЬЩ[XЭ[Ы€‹€ќ[—ЪY€ќ[’Y€ЫШ[€[‹™ЫШ[€XњО€\њ›Ь‹ќXњЛ€™XЫЭ™\ћN€™XЫЭ™\ћQ›ЬЉ›™YYЧЭX—ЬЩ[XЭ[Ы€‹ИЫЫќXЭ€[‹›Z[\ЭЫ™\ЦЬЭ\ќK[™›О€\њ›Ь‹›Y\ЬШYЩHJK€NВ€B‚€ЫЫњЭXЪЩ]ИHЧNВ€ЫЫњЭЫЫ\]YHЧNВ€]\Э™\Э[В€›Ь€
][™^HЭ\ќИ[™^[‹›Z[\ЭЫ™\Л›[™ЭИ[™^
ККHВ€ЫЫњЭZ[\ЭЫ™HH[‹›Z[\ЭЫ™\ЦЪ[™^NВ€ЫЫњЭШ\\™HH]ШZ]\ЛњЭ\ќ™]ЫЬљРШ\\™JX‹ќX’Yќ[’YZ[\ЭЫ™KљY]љY[ЩS]™[
NВ€ЫЫњЭ™\Э[H]ШZ]\Лњќ[ђЫЫќXЭ
Z[\ЭЫ™K™ЫШ[В€‹‹њЪ[™ЫSЬ[ЫњЛ€X’Y€X‹ќX’Y€ЭXШЩ\ЬРЬљ]\љXN€Z[\ЭЫ™KњЭXШЩ\ЬЧШЬљ]\љXK€ЫЫњЭZ[ќО€Z[\ЭЫ™KЫЫњЭZ[ќЛ€ЭZY[ЩN€Z[\ЭЫ™K™ЭZY[ЩK€\ЬЩ\ќ[ЫњО€Z[\ЭЫ™K\ЬЩ\ќ[ЫњЛ€X^XЭ[ЫњО€Z[\ЭЫ™K›X^ШXЭ[ЫњЛ€JNВ€\Э™\Э[H™\Э[В€ЫЫњЭ™]ЫЬљИH]ШZ]\Л™љ[љ\Ъ™]ЫЬљРШ\\™JX‹ќX’YШ\\™Kќ[’YZ[\ЭЫ™KљY]љY[ЩS]™[
NВ€ЫЫњЭ]љY[ЩHHќZ[]љY[ЩTXЪЩ]
Иќ[’YZ[\ЭЫ™K™\Э[™]ЫЬљИJNВ€XЪЩ]Лњ\Ъ
]љY[ЩJNВ‚€Y€
™\Э[њЭ]\ИOOHЫЫ\]YЭ™\љYљYYЉHВ€™]\›€В€‹‹њ™\Э[€ќ[—ЪY€ќ[’Y€[—ЩЫШ[€[‹™ЫШ[€Z[\ЭЫ™WЪ[™^€[™^€Z[\ЭЫ™N€Z[\ЭЫ™Q›Ь’ЬЭ
Z[\ЭЫ™JK€]љY[ЩK€™\Э[YN€Иќ[—ЪY€ќ[’YZ[\ЭЫ™WЪ[™^€[™^[њЭќXЭ[ЫЋ€”]Ъ\ИZ[\ЭЫ™HЭZY[ЩKШЬљ]\љXHY€™YYY[€™\ќ[€HШ[YHZ[\ЭЫ™K€€K€NВ€B‚€ЫЫ\]Yњ\Ъ
Z[\ЭЫ™KљY
NВ€Y€
™]љY]У[ЩHOOHњЭљXЭЉHВ€ЫЫњЭ™^[™^H[™^
ИH[‹›Z[\ЭЫ™\Л›[™ЭИ[™^
ИH€ќ[В€™]\›€В€Э]\О€›Z[\ЭЫ™WЬ™XYWЩ›Ь—Ь™]љY]И‹€ќ[—ЪY€ќ[’Y€ЫШ[€[‹™ЫШ[€Z[\ЭЫ™WЪ[™^€[™^€Z[\ЭЫ™N€Z[\ЭЫ™Q›Ь’ЬЭ
Z[\ЭЫ™JK€]љY[ЩK€™^ЫZ[\ЭЫ™WЪ[™^€™^[™^€[—ШЫЫ\]WШYќ\—Ь™]љY]О€™^[™^OHќ[€ЬЭЪ[њЭќXЭ[ЫЋ€™^[™^OHќ[€И”™]љY]ИH]љY[ЩK€Y€XШЩ\YH[€\ИЫЫ\]NИЭ\ќЪ\ЩH™\ќ[€\ИZ[\ЭЫ™HЪ]ЫЬњ™XЭYЭZY[ЩHЬ€Ьљ]\љXK€‚€€™]љY]ИH]љY[ЩK€Y€XШЩ\YШ[њ›ЭЬЩ\—Ьќ[€YШZ[€Ъ]HШ[YH[‹ќ[—ЪY[™Z[\ЭЫ™WЪ[™^IЫ™^[™^K€Y€™Z™XЭY™\ќ[€Z[\ЭЫ™WЪ[™^IЪ[™^HЪ]ЫЬњ™XЭYЭZY[ЩHЬ€Ьљ]\љXK€NВ€B€B‚€Y€
[Z[\ЭЫ™\Л›[™Э	‰€XЪЩ]Л›[™ЭOOHJHВ€™]\›€И‹‹›\Э™\Э[ќ[—ЪY€ќ[’Y]љY[ЩN€XЪЩ]ЦМHNВ€B€™]\›€В€Э]\О€ЫЫ\]YЭ™\љYљYY‹€ќ[—ЪY€ќ[’Y€ЫШ[€[‹™ЫШ[€Z[\ЭЫ™\ЧШЫЫ\]Y€ЫЫ\]Y€]љY[ЩN€XЪЩ]Л€NВ€B‚€љ[™Э\њ™[ќ[[Y[ќ
Ы[[Y[ќЭ\њ™[ќYЩJHВ€Y€
[Ы[[Y[ќ
H™]\›€[™Yљ[™YВ€ЫЫњЭћTЩ[XЭЬ€HЭ\њ™[ќYЩK™[[Y[ќЛ™љ[™

JHO€KњЩ[XЭЬ€OOHЫ[[Y[ќњЩ[XЭЬЉNВ€Y€
ћTЩ[XЭЬЉH™]\›€ћTЩ[XЭЬЋВ€ЫЫњЭљ[™Щ\њљ[ќH[[Y[ќљ[™Щ\њљ[ќ
Ы[[Y[ќ
NВ€ЫЫњЭX]Ъ\ИHЭ\њ™[ќYЩK™[[Y[ќЛ™љ[\Љ
JHO€[[Y[ќљ[™Щ\њљ[ќ
JHOOHљ[™Щ\њљ[ќ
NВ€Y€
X]Ъ\Л›[™ЭOOHJH™]\›€X]Ъ\ЦМNВ€›ЭИ™]И\њ›ЬЉХSWСSSQS•€	ШњљYYЉЫ[[Y[ќ
_HЪ[™ЩYЬ€\И[XљYЭ[Э\Л€ZЩHH™]Ињ›ЭЬЩ\—ЬЫ\ЪЭ
NВ€B‚€\Ю[ИXЭX[ќX[
ИX’YXЭ[Ы‹[[Y[ќ[YKЩ^HJHВ€ЫЫњЭX€H]ШZ]\ЛњЩ[XЭXЉX’Y
NВ€™]\›€\Л›X\Щ\ЛќЪ]X\ЩJX‹ќX’YИќ[’Y€X[ќX[IЬ[™ЫUURQ

_XK\Ю[И

HO€В€]Ы[[Y[ќВ€Y€
[[Y[ќOHќ[
HВ€Y€
]\ЛњЪЭЫ€\ЛњЪЭЫ‹ќX—ЪYOOHX‹ќX’Y
H›ЭИ™]И\њ›ЬЉ“›ИX]Ъ[™Ињ›ЭЬЩ\—ЬЫ\ЪЭ€ZЩHњ›ЭЬЩ\—ЬЫ\ЪЭљ\њЭ€ЉNВ€Ы[[Y[ќH\ЛњЪЭЫ‹™[[Y[ќЛ™љ[™

JHO€KљHOOH[[Y[ќ
NВ€Y€
[Ы[[Y[ќ
H›ЭИ™]И\њ›ЬЉ[[Y[ќ	Щ[[Y[ќH\И›Э[€H]\Эњ›ЭЬЩ\—ЬЫ\ЪЭ
NВ€B€ЫЫњЭЭ\њ™[ќH[[Y[ќOHќ[И]ШZ]\ЛњЫ\ЪЭ\Љ\ЛљШ\\™KX‹ќX’Y
H€ќ[В€ЫЫњЭЭ\њ™[ќ[[Y[ќHЫ[[Y[ќИ\Л™љ[™Э\њ™[ќ[[Y[ќ
Ы[[Y[ќЭ\њ™[ќ
H€[™Yљ[™YВ€ЫЫњЭ›Ь›X[^™YHВ€ЫЫ€XЭ[Ы‹€\™Щ]€Э\њ™[ќ[[Y[ќЛљK€[€Э\њ™[ќ[[Y[ќ€[YK€Щ^K€NВ€]ШZ]\ЛXЭ
X‹ќX’Y›Ь›X[^™Y
NВ€]ШZ]\ЛњЩ]JX‹ќX’Y
NВ€ЫЫњЭ]Z[H]ШZ]\ЛљШ\\™KќX‘]Z[
X‹ќX’Y
NВ€™]\›€ИXЭ[Ы‹[[Y[ќ€њљYYЉЭ\њ™[ќ[[Y[ќ
KX—ЪY€X‹ќX’Y\›€]Z[ќ\›]N€]Z[ќ]HNВ€JNВ€BџB