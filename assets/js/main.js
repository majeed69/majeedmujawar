/*
  main.js
  =======
  Everything interactive on the page. It is a single classic script (no
  modules, no build step), so the page works when opened straight from disk.

  The page is complete without this file. This script only adds the
  personal touches: the greeting, clocks, live GitHub data, the postcard,
  the shortcuts menu and a few small details.

  Rules this file sticks to:
    - Text from outside (config, GitHub, the address bar) is only ever
      inserted with textContent or DOM methods, never innerHTML.
    - Every storage, clipboard and network call is wrapped in try/catch,
      so private browsing or blocked storage never breaks the page.
    - Nothing is tracked or sent anywhere. The only requests are to the
      public GitHub API.

  Contents
    1. Settings
    2. Small helpers
    3. Reading config.js
    4. Learning about the visitor
    5. Time helpers
    6. Theme
    7. Greeting and tooltips
    8. Clocks and the top bar time
    9. About line and Right now
   10. GitHub API with a cache
   11. Projects
   12. Recruiter questions and email buttons
   13. Postcard
   14. Socials
   15. Shortcuts menu
   16. Navigation highlight, progress line, tab title, idle note
   17. Start
*/

(function () {
  "use strict";

  /* 1. Settings ---------------------------------------------------------- */

  const MUMBAI_TZ = "Asia/Kolkata";
  const INDIA_ZONES = ["Asia/Kolkata", "Asia/Calcutta"];
  const GITHUB_API = "https://api.github.com";
  const CACHE_MS = 6 * 60 * 60 * 1000;      // GitHub responses are reused for 6 hours
  const FETCH_TIMEOUT_MS = 8000;
  const MAILTO_LIMIT = 1800;                // longer mailto links fail in some mail apps
  const IDLE_MS = 40 * 1000;
  const STORE_PREFIX = "mm:";
  const HIDDEN_TITLE = "☕ still here when you’re back";
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Shown instantly for the current projects, then replaced by live GitHub data.
  const KNOWN_PROJECTS = {
    "majeed69/whatthehttp": {
      name: "whatthehttp",
      description: "Type any website and watch DNS, TCP, TLS and HTTP happen step by step, with real DNS data and honest explanations.",
      homepage: "https://majeed69.github.io/whatthehttp/",
      language: "JavaScript",
      topics: ["dns", "http", "tls"],
      pushed_at: "2026-10-23T16:29:06Z"
    },
    "majeed69/bloktra": {
      name: "Bloktra",
      description: "A small, open-source ad and tracker blocker for Chromium browsers. No accounts, no telemetry, nothing leaves your browser.",
      homepage: "",
      language: "JavaScript",
      topics: ["manifest-v3", "privacy"],
      pushed_at: "2026-10-21T19:10:29Z"
    }
  };

  // Filter counts from the Bloktra README ("roughly 116,000 network filters and 31,000 cosmetic ones").
  const BLOKTRA_STATS = [["116k", "network filters"], ["31k", "cosmetic filters"], ["0", "bytes sent home"]];

  // Used by the whatthehttp card when real timing is not available, for example when opened from disk.
  const EXAMPLE_TIMING = [["DNS", 14], ["Connect", 11], ["TLS", 22], ["Waiting", 38], ["Download", 7]];

  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

  /* 2. Small helpers ----------------------------------------------------- */

  function $(id) {
    return document.getElementById(id);
  }

  function reducedMotion() {
    return motionQuery.matches;
  }

  // Creates an element. Text always goes in through textContent.
  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach((key) => {
        const value = props[key];
        if (value == null || value === false) return;
        if (key === "text") node.textContent = value;
        else if (key === "className") node.className = value;
        else node.setAttribute(key, value === true ? "" : String(value));
      });
    }
    if (children != null) {
      [].concat(children).forEach((child) => {
        if (child != null) node.append(child);
      });
    }
    return node;
  }

  const SVG_NS = "http://www.w3.org/2000/svg";

  function svgEl(parent, tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach((key) => node.setAttribute(key, String(attrs[key])));
    parent.append(node);
    return node;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // localStorage and sessionStorage can throw in private modes, so every call is guarded.
  function storageArea(kind) {
    return kind === "session" ? window.sessionStorage : window.localStorage;
  }

  const store = {
    get(key, kind) {
      try {
        return storageArea(kind).getItem(STORE_PREFIX + key);
      } catch (error) {
        return null;
      }
    },
    set(key, value, kind) {
      try {
        storageArea(kind).setItem(STORE_PREFIX + key, value);
        return true;
      } catch (error) {
        return false;
      }
    },
    remove(key, kind) {
      try {
        storageArea(kind).removeItem(STORE_PREFIX + key);
      } catch (error) {
        /* storage blocked, nothing to remove */
      }
    },
    getJSON(key) {
      const raw = store.get(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch (error) {
        return null;
      }
    },
    setJSON(key, value) {
      return store.set(key, JSON.stringify(value));
    }
  };

  // Turns straight quotes into curly ones, so copy from config.js looks right.
  function smartQuotes(text) {
    return String(text)
      .replace(/(^|[\s([{\u201C\u2018-])"/g, "$1\u201C")
      .replace(/"/g, "\u201D")
      .replace(/(^|[\s([{\u201C])'/g, "$1\u2018")
      .replace(/'/g, "\u2019");
  }

  // The site never shows long dashes, even when they come from GitHub.
  function removeDashes(text) {
    return String(text)
      .replace(/\s*[\u2014\u2013]\s*/g, ", ")
      .replace(/\s+-\s+/g, ", ");
  }

  function capitalizeFirst(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }

  // ["a"] -> "a", ["a", "b"] -> "a and b", ["a", "b", "c"] -> "a, b and c"
  function joinNaturally(items) {
    if (items.length <= 1) return items.join("");
    return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
  }

  // Only lets through http and https links (and relative links when allowed).
  function safeLink(value, allowRelative) {
    const text = String(value || "").trim();
    if (!text || /[\s[\]<>"]/.test(text)) return "";
    try {
      const url = new URL(text, document.baseURI);
      const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(text);
      if (url.protocol === "https:" || url.protocol === "http:") return url.href;
      if (allowRelative && !isAbsolute && url.protocol === "file:") return url.href;
    } catch (error) {
      /* not a link */
    }
    return "";
  }

  function externalLink(href, text, extraRel) {
    return el("a", { href, target: "_blank", rel: "noopener" + (extraRel ? " " + extraRel : ""), text });
  }

  /* 3. Reading config.js ------------------------------------------------- */

  const DEFAULTS = {
    siteUrl: "",
    name: "Majeed Mujawar",
    email: "majeedmujawar69@gmail.com",
    github: "majeed69",
    resume: "",
    projects: ["https://github.com/majeed69/whatthehttp", "https://github.com/majeed69/Bloktra"],
    socials: [["GitHub", "https://github.com/majeed69"]],
    learning: [],
    answers: {}
  };

  function warnConfig(message) {
    console.warn("[config.js] " + message);
  }

  // Accepts https://github.com/owner/repo (with or without .git, a trailing slash or extra path).
  function parseRepoLink(link) {
    const match = String(link || "").trim()
      .match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]+?)(?:\.git)?(?:[/?#].*)?$/i);
    if (!match || match[2] === "." || match[2] === "..") return null;
    return { owner: match[1], name: match[2], path: match[1] + "/" + match[2] };
  }

  function readConfig(raw) {
    const source = raw && typeof raw === "object" ? raw : null;
    if (!source) {
      warnConfig("window.SITE_CONFIG was not found. Make sure config.js sits next to index.html and has no typos. The page is using its built in defaults for now.");
    }
    const from = source || {};

    function text(key) {
      const value = from[key];
      if (value == null) return DEFAULTS[key];
      if (typeof value !== "string") {
        warnConfig("\"" + key + "\" should be text inside double quotes. Using the default instead.");
        return DEFAULTS[key];
      }
      return value.trim();
    }

    function list(key) {
      const value = from[key];
      if (value == null) return DEFAULTS[key];
      if (!Array.isArray(value)) {
        warnConfig("\"" + key + "\" should be a list inside square brackets [ ]. Using the default instead.");
        return DEFAULTS[key];
      }
      return value;
    }

    const config = {};

    const siteUrl = text("siteUrl");
    config.siteUrl = /^https?:\/\/[^\s[\]]+$/i.test(siteUrl) ? siteUrl.replace(/\/?$/, "/") : "";
    if (siteUrl && !config.siteUrl) warnConfig("\"siteUrl\" should be a full link like https://majeed69.github.io/. It is ignored for now.");

    config.name = text("name") || DEFAULTS.name;
    config.firstName = config.name.split(/\s+/)[0];

    config.email = text("email");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.email)) {
      warnConfig("\"email\" does not look like an email address. Using " + DEFAULTS.email + " instead.");
      config.email = DEFAULTS.email;
    }

    config.github = text("github").replace(/^@/, "");
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(config.github)) {
      warnConfig("\"github\" should be just your GitHub username, like majeed69. Using " + DEFAULTS.github + " instead.");
      config.github = DEFAULTS.github;
    }

    const resume = text("resume");
    config.resume = resume ? safeLink(resume, true) : "";
    if (resume && !config.resume) warnConfig("\"resume\" should be a link to your resume, like https://... or assets/resume.pdf. The button is hidden for now.");

    const seen = new Set();
    config.projects = [];
    list("projects").forEach((link, index) => {
      const repo = parseRepoLink(link);
      if (!repo) {
        warnConfig("Project " + (index + 1) + " (" + JSON.stringify(link) + ") is not a GitHub repository link. It should look like https://github.com/majeed69/whatthehttp. Skipping it.");
        return;
      }
      const key = repo.path.toLowerCase();
      if (seen.has(key)) {
        warnConfig("Project " + repo.path + " is listed twice. Showing it once.");
        return;
      }
      seen.add(key);
      config.projects.push(repo);
    });

    config.socials = [];
    list("socials").forEach((pair, index) => {
      if (!Array.isArray(pair) || typeof pair[0] !== "string" || !pair[0].trim()) {
        warnConfig("Social " + (index + 1) + " should look like [\"LinkedIn\", \"https://...\"]. Skipping it.");
        return;
      }
      const label = pair[0].trim();
      const rawUrl = typeof pair[1] === "string" ? pair[1].trim() : "";
      if (!rawUrl) return; // An empty link simply hides it.
      const url = safeLink(rawUrl, false);
      if (!url) {
        warnConfig("The link for " + label + " (" + JSON.stringify(rawUrl) + ") should start with https://. Hiding it for now.");
        return;
      }
      config.socials.push({ label, url });
    });

    config.learning = list("learning")
      .filter((item) => typeof item === "string" && item.trim())
      .map((item) => smartQuotes(item.trim()));

    const answers = from.answers && typeof from.answers === "object" ? from.answers : {};
    config.answers = {};
    ["roles", "workMode", "relocate", "start"].forEach((key) => {
      const value = answers[key];
      config.answers[key] = typeof value === "string" ? smartQuotes(value.trim()) : "";
    });

    return config;
  }

  /* 4. Learning about the visitor ---------------------------------------- */

  function readTimeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch (error) {
      return "UTC";
    }
  }

  // "America/Argentina/Buenos_Aires" -> "Buenos Aires"
  function cityFromTimeZone(timeZone) {
    const last = timeZone.split("/").pop() || timeZone;
    return last.replace(/_/g, " ");
  }

  function detectBrowser(ua, isIOS) {
    const quiet = { name: "a browser", how: "Your browser keeps quiet about its name, so I won’t guess.", code: "navigator.userAgent" };
    const said = (name) => ({
      name,
      how: isIOS && name !== "Safari"
        ? "Every browser on iOS runs on Safari’s engine underneath, but yours still mentions its own name."
        : "Your browser introduces itself to every site it visits. It’s called the user agent.",
      code: "navigator.userAgent"
    });

    if (navigator.brave && typeof navigator.brave.isBrave === "function") {
      return { name: "Brave", how: "Brave looks just like Chrome from the outside, but it leaves a small flag that pages can check.", code: "navigator.brave" };
    }
    if (/Edg(?:e|A|iOS)?\//.test(ua)) return said("Edge");
    if (/OPR\/|Opera|OPiOS\/|OPT\//.test(ua)) return said("Opera");
    if (/SamsungBrowser\//.test(ua)) return said("Samsung Internet");
    if (/Firefox\/|FxiOS\//.test(ua)) return said("Firefox");
    if (/Chrome\/|CriOS\/|Chromium\//.test(ua)) return said("Chrome");
    if (/Safari\//.test(ua) && /Version\//.test(ua)) return said("Safari");
    return quiet;
  }

  function detectDevice(ua) {
    const fromUa = (name, extra) => Object.assign({
      name,
      how: "The same introduction from your browser also names your system.",
      code: "navigator.userAgent",
      isIOS: false,
      isMobile: false
    }, extra);

    if (/iPhone|iPod/.test(ua)) return fromUa("an iPhone", { isIOS: true, isMobile: true });
    if (/iPad/.test(ua)) return fromUa("an iPad", { isIOS: true, isMobile: true });
    if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) {
      // iPadOS asks for desktop sites, so it says "Macintosh". Macs have no touch screen, though.
      return fromUa("an iPad", {
        isIOS: true,
        isMobile: true,
        how: "iPads introduce themselves as Macs, but Macs don’t have touch screens. Yours does.",
        code: "navigator.maxTouchPoints > 1"
      });
    }
    if (/Android/.test(ua)) return fromUa("Android", { isMobile: true });
    if (/Macintosh|Mac OS X/.test(ua)) return fromUa("a Mac");
    if (/Windows/.test(ua)) return fromUa("Windows");
    if (/Linux|X11/.test(ua) && !/CrOS/.test(ua)) return fromUa("Linux");
    return fromUa("your device", { how: "Your browser keeps your system to itself, which is fair.", isMobile: /Mobi/.test(ua) });
  }

  // Only letters, numbers, spaces, ".", "&" and "-", at most 40 characters.
  function readCompany() {
    let raw = "";
    try {
      raw = new URLSearchParams(window.location.search).get("for") || "";
    } catch (error) {
      raw = "";
    }
    return raw
      .replace(/[^\p{L}\p{N} .&-]/gu, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40)
      .trim();
  }

  function readReferrer() {
    const result = { host: "", fromLinkedIn: false, fromGitHub: false };
    try {
      const ref = document.referrer || "";
      if (!ref) return result;
      result.fromLinkedIn = /linkedin|lnkd\.in/i.test(ref);
      result.fromGitHub = /github\.com/i.test(ref);
      const url = new URL(ref);
      const here = window.location.hostname.replace(/^www\./, "");
      const host = url.hostname.replace(/^www\./, "");
      if (/^https?:$/.test(url.protocol) && host && host !== here) result.host = host;
      if (host === here) {
        result.fromLinkedIn = false;
        result.fromGitHub = false;
      }
    } catch (error) {
      /* no usable referrer */
    }
    return result;
  }

  // Counts visits on this device. Reloads in the same tab count once.
  function countVisit() {
    let count = parseInt(store.get("visits"), 10) || 0;
    if (!store.get("counted", "session")) {
      count += 1;
      store.set("visits", String(count));
      store.set("counted", "1", "session");
    }
    return Math.max(count, 1);
  }

  function readNavigationTiming() {
    try {
      return performance.getEntriesByType("navigation")[0] || null;
    } catch (error) {
      return null;
    }
  }

  function detectVisitor() {
    const ua = navigator.userAgent || "";
    const timeZone = readTimeZone();
    const isIndia = INDIA_ZONES.indexOf(timeZone) !== -1;
    const device = detectDevice(ua);
    const browser = detectBrowser(ua, device.isIOS);
    const referrer = readReferrer();
    const online = /^https?:$/.test(window.location.protocol);
    const nav = readNavigationTiming();
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const shortSide = Math.min(window.screen.width || 0, window.screen.height || 0);

    return {
      timeZone,
      isIndia,
      city: isIndia ? "Mumbai" : cityFromTimeZone(timeZone),
      place: isIndia ? "India" : cityFromTimeZone(timeZone),
      browser,
      device,
      isPhone: (coarse && shortSide > 0 && shortSide < 600) || /iPhone|iPod/.test(ua),
      isChromium: ["Chrome", "Edge", "Brave", "Opera"].indexOf(browser.name) !== -1,
      company: readCompany(),
      referrer,
      online,
      nav,
      loadMs: online && nav && nav.responseEnd > 0 ? Math.max(1, Math.round(nav.responseEnd)) : 0,
      visits: countVisit()
    };
  }

  /* 5. Time helpers ------------------------------------------------------ */

  const formatters = {};

  function partsIn(timeZone, date) {
    if (!formatters[timeZone]) {
      formatters[timeZone] = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
        year: "numeric",
        month: "numeric",
        day: "numeric"
      });
    }
    const parts = {};
    formatters[timeZone].formatToParts(date || new Date()).forEach((part) => {
      if (part.type !== "literal") parts[part.type] = parseInt(part.value, 10);
    });
    if (parts.hour === 24) parts.hour = 0;
    return parts;
  }

  // 21:42 -> "9:42 pm", with a non breaking space so it never splits across lines.
  function formatTime(parts, withSeconds) {
    const hour12 = parts.hour % 12 || 12;
    const minutes = String(parts.minute).padStart(2, "0");
    const seconds = withSeconds ? ":" + String(parts.second).padStart(2, "0") : "";
    return hour12 + ":" + minutes + seconds + "\u00A0" + (parts.hour < 12 ? "am" : "pm");
  }

  function timeIn(timeZone, withSeconds) {
    return formatTime(partsIn(timeZone), withSeconds);
  }

  function mumbaiHour() {
    return partsIn(MUMBAI_TZ).hour;
  }

  function greetingFor(hour) {
    if (hour < 5) return "Up late.";
    if (hour < 12) return "Good morning.";
    if (hour < 17) return "Good afternoon.";
    return "Good evening.";
  }

  function mumbaiStatus(hour) {
    if (hour < 7) return "Probably asleep. I reply first thing in the morning.";
    if (hour < 10) return "Probably on coffee #1.";
    if (hour < 13) return "Probably building something.";
    if (hour < 15) return "Probably on coffee #2.";
    if (hour < 19) return "Probably deep in a terminal.";
    return "Probably tinkering with a side project.";
  }

  function coffeeCount(hour) {
    if (hour < 8) return 0;
    if (hour < 11) return 1;
    if (hour < 15) return 2;
    return 3;
  }

  function isLateInMumbai() {
    const hour = mumbaiHour();
    return hour >= 23 || hour < 7;
  }

  function postmarkDate(date) {
    return String(date.getDate()).padStart(2, "0") + " " + MONTHS[date.getMonth()].toUpperCase() + " " + date.getFullYear();
  }

  function daysAgoLabel(time) {
    const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const days = Math.round((startOfDay(new Date()) - startOfDay(new Date(time))) / 86400000);
    if (days <= 0) return "Today";
    if (days === 1) return "Yesterday";
    return days + " days ago";
  }

  /* 6. Theme ------------------------------------------------------------- */

  const THEMES = ["auto", "light", "dark"];
  const THEME_NAMES = { auto: "Auto", light: "Light", dark: "Dark" };
  const THEME_COLORS = { light: "#EEF0EB", dark: "#141613" };
  let currentTheme = "auto";

  function applyTheme(mode) {
    const root = document.documentElement;
    if (mode === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", mode);

    const button = $("theme-btn");
    const next = THEMES[(THEMES.indexOf(mode) + 1) % THEMES.length];
    button.setAttribute("data-mode", mode);
    button.setAttribute("aria-label", "Color theme: " + THEME_NAMES[mode] + ". Switch to " + THEME_NAMES[next] + ".");

    // Keeps the browser's own toolbar color in step with the chosen theme.
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      const scheme = /dark/.test(meta.media) ? "dark" : "light";
      meta.setAttribute("content", THEME_COLORS[mode === "auto" ? scheme : mode]);
    });
  }

  function cycleTheme() {
    currentTheme = THEMES[(THEMES.indexOf(currentTheme) + 1) % THEMES.length];
    if (currentTheme === "auto") store.remove("theme");
    else store.set("theme", currentTheme);
    applyTheme(currentTheme);
    toast(currentTheme === "auto" ? "Following your system theme." : THEME_NAMES[currentTheme] + " theme, saved for next time.");
  }

  function isDarkNow() {
    return currentTheme === "dark" || (currentTheme === "auto" && darkQuery.matches);
  }

  function initTheme() {
    const saved = store.get("theme");
    currentTheme = saved === "light" || saved === "dark" ? saved : "auto";
    applyTheme(currentTheme);
    $("theme-btn").addEventListener("click", cycleTheme);
  }

  /* 7. Greeting and tooltips --------------------------------------------- */

  // The greeting is a list of pieces. Plain pieces are text, facts become buttons.
  function buildGreeting(visitor) {
    const pieces = [];
    const say = (text) => pieces.push({ text });
    const fact = (text, how, code) => pieces.push({ text, how, code });

    say(greetingFor(partsIn(visitor.timeZone).hour) + " ");

    if (visitor.company) {
      say("Hi, ");
      fact(visitor.company + " team", "You opened a link I made for your team, and the name is right there in the address.", "new URLSearchParams(location.search).get(\"for\")");
      say(". ");
    }

    say("You’re on ");
    fact(visitor.browser.name, visitor.browser.how, visitor.browser.code);
    say(" on ");
    fact(visitor.device.name, visitor.device.how, visitor.device.code);
    say(", it’s ");

    const zoneCode = "Intl.DateTimeFormat().resolvedOptions().timeZone";
    if (visitor.isIndia) {
      fact(timeIn(visitor.timeZone), "Your device says it’s on India Standard Time, same as mine.", zoneCode);
      say(" for both of us. ");
    } else {
      fact(timeIn(visitor.timeZone), "Your device keeps its own clock and timezone (" + visitor.timeZone + "). Nothing is sent anywhere.", zoneCode);
      say(" where you are and ");
      fact(timeIn(MUMBAI_TZ), "Your own clock, shifted to India Standard Time, which is UTC+5:30.", "new Date().toLocaleTimeString(\"en-US\", { timeZone: \"Asia/Kolkata\" })");
      say(" here in Mumbai. ");
    }

    if (visitor.online && visitor.loadMs) {
      say("This page reached you in ");
      fact(visitor.loadMs + "\u00A0ms", "Your browser times every page it loads, from looking up my address to the last byte arriving.", "performance.getEntriesByType(\"navigation\")[0].responseEnd");
      say(". ");
    } else if (!visitor.online) {
      say("You opened me ");
      fact("straight from your computer", "The address of this page starts with file://, so there was no network trip at all.", "location.protocol === \"file:\"");
      say(", so I arrived instantly. ");
    }

    if (visitor.referrer.host) {
      say("You came over from ");
      fact(visitor.referrer.host, "When you follow a link, your browser usually tells the next site where you came from.", "document.referrer");
      say(". ");
    }

    if (darkQuery.matches && isDarkNow()) {
      say("And you prefer ");
      fact("dark mode", "Your system settings share whether you like light or dark, and the page follows along.", "matchMedia(\"(prefers-color-scheme: dark)\").matches");
      say(", so the lights are off.");
    }

    // Trim the space after the final sentence.
    const last = pieces[pieces.length - 1];
    if (!last.how) last.text = last.text.replace(/\s+$/, "");
    return pieces;
  }

  // A fact is a real button (for keyboards and screen readers) next to the highlighted text you see.
  // The visible text is a plain inline span, so a long company name wraps like any other words.
  function makeFact(piece, visibleText) {
    const button = el("button", { type: "button", className: "fact", text: piece.text });
    const label = el("span", { className: "fact-text", "aria-hidden": "true", text: visibleText });
    return el("span", { className: "fact-group", "data-how": piece.how, "data-code": piece.code }, [button, label]);
  }

  function finishGreeting(box, fullText) {
    box.classList.add("is-done");
    const ghost = box.querySelector(".greet-ghost");
    if (ghost) ghost.remove();
    $("intro").classList.add("is-shown");
    $("hint").classList.add("is-shown");

    // Announce the finished sentence once, then clear it so it is not read twice later.
    const live = $("greet-live");
    live.textContent = fullText;
    setTimeout(() => {
      live.textContent = "";
    }, 8000);
  }

  function charDelay(char) {
    if (char === ".") return 240;
    if (char === ",") return 110;
    return 14 + Math.random() * 16;
  }

  async function typeGreeting(box, layer, pieces) {
    const caret = el("span", { className: "caret", "aria-hidden": "true" });
    layer.append(caret);
    let rushed = false;
    const rush = () => {
      if (document.hidden) rushed = true;
    };
    document.addEventListener("visibilitychange", rush);

    for (const piece of pieces) {
      const node = piece.how ? makeFact(piece, "") : document.createTextNode("");
      const target = piece.how ? node.lastChild : node;
      layer.insertBefore(node, caret);
      for (const char of Array.from(piece.text)) {
        if (rushed || reducedMotion()) {
          target.textContent = piece.text;
          break;
        }
        target.textContent += char;
        await wait(charDelay(char));
      }
      if (piece.how) requestAnimationFrame(() => node.classList.add("is-marked"));
    }

    document.removeEventListener("visibilitychange", rush);
    setTimeout(() => caret.remove(), reducedMotion() ? 0 : 1400);
  }

  function renderGreeting(visitor) {
    const box = $("greet");
    const pieces = buildGreeting(visitor);
    const fullText = pieces.map((piece) => piece.text).join("");
    const layer = el("span", { className: "greet-typed" });
    box.textContent = "";

    if (reducedMotion()) {
      pieces.forEach((piece) => {
        layer.append(piece.how ? makeFact(piece, piece.text) : piece.text);
      });
      layer.querySelectorAll(".fact-group").forEach((fact) => fact.classList.add("is-marked"));
      box.append(layer);
      finishGreeting(box, fullText);
      return;
    }

    // An invisible copy of the full sentence holds the space, so nothing moves while it types.
    const ghost = el("span", { className: "greet-ghost", "aria-hidden": "true" });
    pieces.forEach((piece) => {
      ghost.append(piece.how ? el("span", { className: "ghost-fact", text: piece.text }) : piece.text);
    });
    box.append(ghost, layer);

    typeGreeting(box, layer, pieces).then(() => finishGreeting(box, fullText));
  }

  // One shared tooltip explains how the page knows each fact.
  const tipState = { owner: null, pinned: false, frame: 0 };

  function factFrom(event) {
    return event.target instanceof Element ? event.target.closest(".fact-group") : null;
  }

  function positionTip() {
    tipState.frame = 0;
    const owner = tipState.owner;
    if (!owner) return;
    const tip = $("tip");
    const rect = owner.lastChild.getBoundingClientRect();
    const viewWidth = document.documentElement.clientWidth;
    const viewHeight = window.innerHeight;
    if (rect.bottom < 0 || rect.top > viewHeight) {
      hideTip();
      return;
    }
    const edge = 12;
    const gap = 10;
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(edge, Math.min(left, viewWidth - width - edge));
    let top = rect.bottom + gap;
    if (top + height > viewHeight - edge && rect.top - gap - height >= edge) top = rect.top - gap - height;
    tip.style.transform = "translate(" + Math.round(left) + "px, " + Math.round(top) + "px)";
  }

  function schedulePositionTip() {
    if (tipState.owner && !tipState.frame) tipState.frame = requestAnimationFrame(positionTip);
  }

  function showTip(group, pinned) {
    const tip = $("tip");
    if (tipState.owner && tipState.owner !== group) tipState.owner.firstChild.removeAttribute("aria-describedby");
    $("tip-text").textContent = group.getAttribute("data-how") || "";
    $("tip-code").textContent = group.getAttribute("data-code") || "";
    tip.hidden = false;
    tipState.owner = group;
    tipState.pinned = pinned;
    group.firstChild.setAttribute("aria-describedby", "tip");
    positionTip();
  }

  function hideTip() {
    if (tipState.owner) tipState.owner.firstChild.removeAttribute("aria-describedby");
    tipState.owner = null;
    tipState.pinned = false;
    $("tip").hidden = true;
  }

  function initTooltips() {
    const greet = $("greet");

    greet.addEventListener("pointerover", (event) => {
      const fact = factFrom(event);
      if (fact && event.pointerType === "mouse" && !(tipState.pinned && tipState.owner === fact)) showTip(fact, false);
    });
    greet.addEventListener("pointerout", (event) => {
      const fact = factFrom(event);
      if (fact && event.pointerType === "mouse" && tipState.owner === fact && !tipState.pinned && !fact.contains(event.relatedTarget)) hideTip();
    });
    greet.addEventListener("focusin", (event) => {
      const fact = factFrom(event);
      if (fact) showTip(fact, false);
    });
    greet.addEventListener("focusout", (event) => {
      const fact = factFrom(event);
      if (fact && tipState.owner === fact && !fact.contains(event.relatedTarget)) hideTip();
    });
    // A click or tap pins the tooltip open. A second one closes it.
    greet.addEventListener("click", (event) => {
      const fact = factFrom(event);
      if (!fact) return;
      if (tipState.owner === fact && tipState.pinned) hideTip();
      else showTip(fact, true);
    });

    document.addEventListener("pointerdown", (event) => {
      if (tipState.owner && !factFrom(event)) hideTip();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && tipState.owner) hideTip();
    });
    window.addEventListener("scroll", schedulePositionTip, { passive: true });
    window.addEventListener("resize", schedulePositionTip);
  }

  /* 8. Clocks and the top bar time --------------------------------------- */

  function buildClockFace(svg) {
    svgEl(svg, "circle", { cx: 50, cy: 50, r: 46, fill: "none", stroke: "currentColor", "stroke-width": 1.5 });
    for (let i = 0; i < 12; i += 1) {
      const angle = i * Math.PI / 6;
      const inner = i % 3 === 0 ? 35 : 39;
      svgEl(svg, "line", {
        x1: (50 + Math.sin(angle) * inner).toFixed(2),
        y1: (50 - Math.cos(angle) * inner).toFixed(2),
        x2: (50 + Math.sin(angle) * 42).toFixed(2),
        y2: (50 - Math.cos(angle) * 42).toFixed(2),
        stroke: "currentColor",
        "stroke-width": i % 3 === 0 ? 2.2 : 1.2,
        "stroke-linecap": "round"
      });
    }
    const hour = svgEl(svg, "line", { x1: 50, y1: 54, x2: 50, y2: 28, stroke: "currentColor", "stroke-width": 3.6, "stroke-linecap": "round" });
    const minute = svgEl(svg, "line", { x1: 50, y1: 55, x2: 50, y2: 15, stroke: "currentColor", "stroke-width": 2.2, "stroke-linecap": "round" });
    const second = svgEl(svg, "line", { class: "clock-second", x1: 50, y1: 58, x2: 50, y2: 12, "stroke-width": 1.2, "stroke-linecap": "round" });
    svgEl(svg, "circle", { class: "clock-pin", cx: 50, cy: 50, r: 2.6 });
    return { hour, minute, second, label: "" };
  }

  function setClockHands(hands, parts) {
    hands.hour.setAttribute("transform", "rotate(" + ((parts.hour % 12) * 30 + parts.minute / 2) + " 50 50)");
    hands.minute.setAttribute("transform", "rotate(" + (parts.minute * 6 + parts.second / 10) + " 50 50)");
    hands.second.setAttribute("transform", "rotate(" + parts.second * 6 + " 50 50)");
  }

  function visitorStatus(visitor, hour) {
    if (visitor.isIndia) return "Same timezone. Easy to schedule.";
    if (hour >= 9 && hour < 18) return "Your working hours.";
    return "Outside your working hours, so thanks for being here.";
  }

  function startClocks(visitor, onMinute) {
    const you = buildClockFace($("clock-you"));
    const me = buildClockFace($("clock-me"));
    $("you-who").textContent = visitor.isIndia ? "You, also on Mumbai time" : "You, in " + visitor.city;
    let timer = 0;
    let lastMinute = -1;

    function tick() {
      const now = new Date();
      const yours = partsIn(visitor.timeZone, now);
      const mine = partsIn(MUMBAI_TZ, now);
      setClockHands(you, yours);
      setClockHands(me, mine);
      $("you-time").textContent = formatTime(yours, true);
      $("me-time").textContent = formatTime(mine, true);

      if (mine.minute !== lastMinute) {
        lastMinute = mine.minute;
        $("you-status").textContent = visitorStatus(visitor, yours.hour);
        $("me-status").textContent = mumbaiStatus(mine.hour);
        $("mumbai-now").textContent = "Mumbai " + formatTime(mine, false) + ", coffee #" + coffeeCount(mine.hour);
        $("clock-you").setAttribute("aria-label", "Clock showing " + formatTime(yours, false) + ", your time");
        $("clock-me").setAttribute("aria-label", "Clock showing " + formatTime(mine, false) + " in Mumbai");
        onMinute();
      }
    }

    function loop() {
      tick();
      timer = setTimeout(loop, 1000 - (Date.now() % 1000) + 10);
    }

    function stop() {
      clearTimeout(timer);
      timer = 0;
    }

    // No need to keep ticking while the tab is hidden.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
      else if (!timer) loop();
    });
    loop();
  }

  /* 9. About line and Right now ------------------------------------------ */

  function aboutLine(visitor) {
    const lines = [];
    if (visitor.company) lines.push(visitor.company + " team, this one’s for you.");
    if (visitor.referrer.fromLinkedIn) lines.push("You probably just saw my LinkedIn. Here’s the part it can’t show.");
    else if (visitor.referrer.fromGitHub) lines.push("Coming from GitHub? Then you’ve seen the code. Here’s the person.");
    if (visitor.isPhone) lines.push("You’re on your phone, so I’ll keep it short.");
    if (visitor.visits > 1) lines.push("Welcome back. This is visit #" + visitor.visits + " from this device.");
    return lines.length ? lines.join(" ") : "Hi, nice to meet you.";
  }

  function renderNow(config) {
    const first = config.learning[0];
    const rest = config.learning.slice(1);
    if (first) $("now-learning-value").textContent = first;
    else $("now-learning").hidden = true;
    if (rest.length) $("now-also-value").textContent = joinNaturally(rest);
    else $("now-also").hidden = true;
    showPushFallback(config.github);
    loadLastPush(config.github);
  }

  function showPushFallback(user) {
    const value = $("now-push-value");
    value.textContent = "";
    value.append(externalLink("https://github.com/" + user, "On GitHub"));
    $("now-push-note").textContent = "Open it to see what I’m pushing lately.";
  }

  async function loadLastPush(user) {
    const repos = await githubJson("/users/" + encodeURIComponent(user) + "/repos?sort=pushed&per_page=1", slimRepoList);
    const repo = Array.isArray(repos) ? repos[0] : null;
    const pushed = repo ? Date.parse(repo.pushed_at) : NaN;
    if (!repo || !repo.name || isNaN(pushed)) return;
    $("now-push-value").textContent = daysAgoLabel(pushed);
    const note = $("now-push-note");
    note.textContent = "";
    note.append("to ", externalLink("https://github.com/" + user + "/" + encodeURIComponent(repo.name), repo.name), ", live from my GitHub.");
  }

  /* 10. GitHub API with a cache ------------------------------------------ */

  // Visitors get 60 GitHub requests an hour, so answers are cached for 6 hours.
  // Any failure quietly returns the last good answer, or null.
  async function githubJson(path, slim) {
    const key = "gh:" + path;
    const cached = store.getJSON(key);
    const stale = cached && cached.data != null ? cached.data : null;
    if (stale != null && Date.now() - cached.time < CACHE_MS) return stale;

    const waitUntil = Number(store.get("gh:wait")) || 0;
    if (Date.now() < waitUntil || typeof window.fetch !== "function") return stale;

    let timer = 0;
    try {
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      if (controller) timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const response = await fetch(GITHUB_API + path, {
        headers: { Accept: "application/vnd.github+json" },
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: controller ? controller.signal : undefined
      });
      if (!response.ok) {
        noteGithubFailure(response, path);
        return stale;
      }
      const data = slim(await response.json());
      if (data != null) store.setJSON(key, { time: Date.now(), data });
      return data != null ? data : stale;
    } catch (error) {
      return stale;
    } finally {
      clearTimeout(timer);
    }
  }

  function noteGithubFailure(response, path) {
    if (response.status === 403 || response.status === 429) {
      // Rate limited. Wait until GitHub says the limit resets (or 15 minutes).
      const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
      store.set("gh:wait", String(reset > Date.now() ? reset : Date.now() + 15 * 60 * 1000));
    } else if (response.status === 404 && path.indexOf("/repos/") === 0) {
      warnConfig("GitHub could not find " + path.slice(7) + ". Check the link in the projects list, or make sure the repository is public.");
    }
  }

  function slimRepo(data) {
    if (!data || typeof data !== "object" || typeof data.name !== "string") return null;
    return {
      name: data.name,
      description: typeof data.description === "string" ? data.description : "",
      homepage: typeof data.homepage === "string" ? data.homepage : "",
      language: typeof data.language === "string" ? data.language : "",
      topics: Array.isArray(data.topics) ? data.topics.filter((topic) => typeof topic === "string").slice(0, 3) : [],
      pushed_at: typeof data.pushed_at === "string" ? data.pushed_at : ""
    };
  }

  function slimRepoList(data) {
    if (!Array.isArray(data)) return null;
    return data.slice(0, 1).map((repo) => ({
      name: repo && typeof repo.name === "string" ? repo.name : "",
      pushed_at: repo && typeof repo.pushed_at === "string" ? repo.pushed_at : ""
    }));
  }

  /* 11. Projects --------------------------------------------------------- */

  // Cleans a GitHub description: drops a repeated "Name - " prefix, long dashes and straight quotes.
  function cleanDescription(text, name) {
    let result = String(text || "").trim();
    const prefix = new RegExp("^" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*[-:|\u2014\u2013]\\s*", "i");
    result = result.replace(prefix, "");
    return capitalizeFirst(smartQuotes(removeDashes(result)));
  }

  function visitTimingRows(visitor) {
    const nav = visitor.nav;
    if (!visitor.online || !nav) return null;
    const tlsStart = nav.secureConnectionStart > 0 ? nav.secureConnectionStart : 0;
    const rows = [
      ["DNS", nav.domainLookupEnd - nav.domainLookupStart],
      ["Connect", (tlsStart || nav.connectEnd) - nav.connectStart],
      ["TLS", tlsStart ? nav.connectEnd - tlsStart : 0],
      ["Waiting", nav.responseStart - nav.requestStart],
      ["Download", nav.responseEnd - nav.responseStart]
    ].map((row) => [row[0], Math.max(0, Math.round(row[1] || 0))]);
    return rows.some((row) => row[1] > 0) ? rows : null;
  }

  function renderVisitTiming(visitor) {
    const box = el("div", { className: "project-live" });
    const label = el("p", { className: "project-live-label hand", text: "Here’s your own visit to this page:" });
    let rows = visitTimingRows(visitor);
    if (!rows) {
      rows = EXAMPLE_TIMING;
      label.textContent = "Example numbers. Once this is online, you’ll see your own.";
    }
    const max = Math.max(1, ...rows.map((row) => row[1]));
    const chart = el("dl", { className: "waterfall" });
    rows.forEach((row) => {
      const bar = el("span", { className: "waterfall-bar" });
      bar.style.width = Math.max(2, (row[1] / max) * 100).toFixed(1) + "%";
      chart.append(
        el("dt", { text: row[0] }),
        el("dd", { className: "waterfall-track", "aria-hidden": "true" }, bar),
        el("dd", { className: "waterfall-ms", text: row[1] + " ms" })
      );
    });
    box.append(label, chart);
    return box;
  }

  function renderBloktraNote(visitor) {
    const browser = visitor.browser.name;
    let line;
    if (visitor.isChromium && !visitor.device.isMobile) line = "You’re on " + browser + ", so you could install this right now.";
    else if (visitor.isChromium) line = "You’re on " + browser + " on " + visitor.device.name + ". Bloktra runs on desktop Chrome, Edge and Brave for now.";
    else line = "You’re on " + browser + ". Bloktra runs on Chrome, Edge and Brave for now.";

    const stats = el("div", { className: "stats" });
    BLOKTRA_STATS.forEach((stat) => {
      stats.append(el("p", null, [el("span", { className: "stat-value", text: stat[0] }), el("span", { className: "stat-label", text: stat[1] })]));
    });
    return el("div", { className: "project-live" }, [el("p", { className: "project-live-label hand", text: line }), stats]);
  }

  // Special live extras, keyed by repository name. Any other project gets the standard card.
  const PROJECT_EXTRAS = {
    whatthehttp: { render: renderVisitTiming },
    bloktra: {
      render: renderBloktraNote,
      primary: (repoUrl) => ({ label: "Install", href: repoUrl + "#install" })
    }
  };

  function fillProjectCard(card, repo, data, extra) {
    const repoUrl = "https://github.com/" + repo.path;
    const name = data && data.name ? data.name : repo.name;
    card.title.textContent = name;

    if (data) {
      card.desc.textContent = cleanDescription(data.description, name) || "Open the code to see what this one does.";
      card.tags.textContent = "";
      const tags = [data.language].concat(data.topics || []).filter(Boolean).slice(0, 4);
      const pushed = Date.parse(data.pushed_at);
      if (!isNaN(pushed)) {
        const date = new Date(pushed);
        tags.push("updated " + MONTHS[date.getMonth()] + " " + date.getFullYear());
      }
      tags.forEach((tag) => card.tags.append(el("li", { text: tag })));
      card.tags.hidden = tags.length === 0;
    }

    card.links.textContent = "";
    const homepage = data ? safeLink(data.homepage, false) : "";
    const primary = extra && extra.primary ? extra.primary(repoUrl) : homepage ? { label: "Try it", href: homepage } : null;
    if (primary) card.links.append(el("a", { className: "btn btn-solid", href: primary.href, target: "_blank", rel: "noopener", text: primary.label }));
    card.links.append(el("a", { className: "btn", href: repoUrl, target: "_blank", rel: "noopener", text: "Code" }));
  }

  function buildProjectCard(repo, visitor) {
    const extra = PROJECT_EXTRAS[repo.name.toLowerCase()];
    const card = {
      root: el("article", { className: "project" }),
      title: el("h3", { className: "project-name", text: repo.name }),
      desc: el("p", { className: "project-desc", text: "Fetching the details from GitHub…" }),
      tags: el("ul", { className: "tags", "aria-label": "Details" }),
      links: el("div", { className: "project-links" })
    };
    card.root.append(card.title, card.desc, card.tags);
    if (extra) card.root.append(extra.render(visitor));
    card.root.append(card.links);

    const fallback = KNOWN_PROJECTS[repo.path.toLowerCase()] || null;
    fillProjectCard(card, repo, fallback, extra);

    githubJson("/repos/" + repo.path, slimRepo).then((data) => {
      if (data) fillProjectCard(card, repo, data, extra);
      else if (!fallback) card.desc.textContent = "Open the code to see what this one does.";
    });
    return card.root;
  }

  function renderProjects(config, visitor) {
    const grid = $("projects");
    grid.textContent = "";
    config.projects.forEach((repo) => grid.append(buildProjectCard(repo, visitor)));
    grid.hidden = config.projects.length === 0;
    $("more-github").setAttribute("href", "https://github.com/" + config.github + "?tab=repositories");
  }

  /* 12. Recruiter questions and email buttons ---------------------------- */

  function mailtoLink(email, subject, body) {
    let href = "mailto:" + email + "?subject=" + encodeURIComponent(subject);
    if (body) href += "&body=" + encodeURIComponent(body);
    return href;
  }

  function emailSubject(config, visitor) {
    return "Hi " + config.firstName + (visitor.company ? ", from " + visitor.company : "");
  }

  // Anything inside [square brackets] gets a yellow highlight, so unfinished answers stand out.
  function setAnswerText(node, text) {
    node.textContent = "";
    text.split(/(\[[^\]]*\])/).forEach((piece) => {
      if (!piece) return;
      node.append(/^\[[^\]]*\]$/.test(piece) ? el("mark", { className: "todo", text: piece }) : piece);
    });
  }

  function reachLine() {
    return "Email works best. " + (isLateInMumbai()
      ? "It’s late in Mumbai right now, so you’ll hear back in the morning."
      : "Right now it’s " + timeIn(MUMBAI_TZ) + " in Mumbai, so you’ll likely hear back today.");
  }

  async function copyEmail(email) {
    try {
      if (!navigator.clipboard || !window.isSecureContext) throw new Error("Clipboard not available");
      await navigator.clipboard.writeText(email);
      toast("Copied. Talk soon.");
    } catch (error) {
      toast("Here it is: " + email, 7000);
    }
  }

  // A contact card (vCard 3.0) with name, email, the site and socials, for saving straight into contacts.
  function vcardText(config) {
    const esc = (value) => value.replace(/[\\,;]/g, "\\$&");
    const parts = config.name.split(/\s+/);
    const family = parts.length > 1 ? parts.pop() : "";
    const lines = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:" + esc(config.name),
      "N:" + esc(family) + ";" + esc(parts.join(" ")) + ";;;",
      "EMAIL;TYPE=INTERNET:" + config.email
    ];
    if (config.siteUrl) lines.push("URL:" + config.siteUrl);
    // Apple Contacts shows X-ABLabel as the link's name. Other apps just see the URL.
    config.socials.forEach((social, index) => {
      lines.push("item" + (index + 1) + ".URL:" + social.url, "item" + (index + 1) + ".X-ABLabel:" + esc(social.label));
    });
    lines.push("END:VCARD");
    return lines.join("\r\n") + "\r\n";
  }

  function vcardFileName(config) {
    return config.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".vcf";
  }

  function renderFaq(config, visitor) {
    document.querySelectorAll("[data-answer]").forEach((node) => {
      const text = config.answers[node.getAttribute("data-answer")];
      const item = node.closest(".qa");
      if (!text) {
        item.hidden = true;
        return;
      }
      item.hidden = false;
      setAnswerText(node, text);
    });

    $("reach-line").textContent = reachLine();
    $("email-btn").setAttribute("href", mailtoLink(config.email, emailSubject(config, visitor)));
    $("copy-btn").addEventListener("click", () => copyEmail(config.email));
    const vcard = $("vcard-btn");
    vcard.setAttribute("href", "data:text/vcard;charset=utf-8," + encodeURIComponent(vcardText(config)));
    vcard.setAttribute("download", vcardFileName(config));
    const resume = $("resume-btn");
    if (config.resume) {
      resume.setAttribute("href", config.resume);
      resume.hidden = false;
    }
  }

  /* 13. Postcard --------------------------------------------------------- */

  function buildStampPerforation() {
    const holes = $("stamp-holes");
    const width = 104;
    const height = 124;
    const radius = 3.2;
    const along = (length) => {
      const count = Math.round(length / 8);
      return Array.from({ length: count + 1 }, (unused, i) => (i * length) / count);
    };
    along(width).forEach((x) => {
      svgEl(holes, "circle", { cx: x.toFixed(2), cy: 0, r: radius });
      svgEl(holes, "circle", { cx: x.toFixed(2), cy: height, r: radius });
    });
    along(height).forEach((y) => {
      svgEl(holes, "circle", { cx: 0, cy: y.toFixed(2), r: radius });
      svgEl(holes, "circle", { cx: width, cy: y.toFixed(2), r: radius });
    });
  }

  function buildPostmark(visitor) {
    const svg = $("postmark");
    const defs = svgEl(svg, "defs", {});
    // The label runs along a 220 degree arc over the top of the inner circle.
    svgEl(defs, "path", { id: "postmark-arc", d: "M 19.6 74.7 A 43 43 0 1 1 100.4 74.7" });

    svgEl(svg, "circle", { cx: 60, cy: 60, r: 53, fill: "none", stroke: "currentColor", "stroke-width": 2.6 });
    svgEl(svg, "circle", { cx: 60, cy: 60, r: 34, fill: "none", stroke: "currentColor", "stroke-width": 1.5 });

    // Long city names get a smaller font, so the label always fits on the arc.
    const label = ("Posted from " + visitor.place).toUpperCase();
    const spacing = 1.2;
    const fontSize = Math.max(5.5, Math.min(9.5, (156 / label.length - spacing) / 0.6));
    const arcText = svgEl(svg, "text", { class: "postmark-text", fill: "currentColor", "font-size": fontSize.toFixed(2), "letter-spacing": spacing });
    const path = svgEl(arcText, "textPath", { href: "#postmark-arc", startOffset: "50%", "text-anchor": "middle" });
    path.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "#postmark-arc");
    path.textContent = label;

    const date = svgEl(svg, "text", { class: "postmark-text", x: 60, y: 63, "text-anchor": "middle", fill: "currentColor", "font-size": 9.5, "letter-spacing": 0.4 });
    date.textContent = postmarkDate(new Date());
    svgEl(svg, "path", { d: "M 44 72 H 76", stroke: "currentColor", "stroke-width": 1.2 });

    // Four wavy cancellation lines that run across the stamp.
    for (let i = 0; i < 4; i += 1) {
      const y = 40 + i * 13;
      let d = "M 116 " + y;
      for (let x = 0; x < 8; x += 1) d += " q 5.5 " + (x % 2 ? 4 : -4) + " 11 0";
      svgEl(svg, "path", { d, fill: "none", stroke: "currentColor", "stroke-width": 1.8, "stroke-linecap": "round" });
    }
  }

  // Builds the mailto link, trimming a long message so the whole link stays under the limit.
  function buildPostcardMail(email, subject, message, from, place) {
    const body = (text) => [text, "", from ? "From " + from : null, "Posted from " + place + " via your portfolio"]
      .filter((line) => line !== null)
      .join("\r\n");
    const full = mailtoLink(email, subject, body(message));
    if (full.length <= MAILTO_LIMIT) return { href: full, trimmed: false };

    const chars = Array.from(message);
    let low = 0;
    let high = chars.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (mailtoLink(email, subject, body(chars.slice(0, mid).join("") + "…")).length <= MAILTO_LIMIT) low = mid;
      else high = mid - 1;
    }
    let cut = chars.slice(0, low).join("");
    const lastSpace = cut.search(/\s\S*$/);
    if (lastSpace > cut.length - 40 && lastSpace > 0) cut = cut.slice(0, lastSpace);
    return { href: mailtoLink(email, subject, body(cut.replace(/\s+$/, "") + "…")), trimmed: true };
  }

  function setPostcardNote(text, isError) {
    const note = $("pc-note");
    note.textContent = text;
    note.classList.toggle("is-error", Boolean(isError));
  }

  function slamPostedStamp() {
    const stamp = $("posted");
    stamp.classList.remove("is-on");
    void stamp.offsetWidth; // restarts the animation
    stamp.classList.add("is-on");
  }

  function initPostcard(config, visitor) {
    buildStampPerforation();
    buildPostmark(visitor);

    const message = $("pc-message");
    const from = $("pc-from");
    const defaultNote = "Opens your email app with it written in.";

    $("hi-lead").textContent = (visitor.company ? visitor.company + " team, write me a postcard." : "Write me a postcard.")
      + " It goes straight to my inbox" + (isLateInMumbai() ? ", and I’ll read it first thing in the morning." : ".");
    if (visitor.company) from.setAttribute("placeholder", "Your name, " + visitor.company);
    const addressName = document.querySelector(".pc-address .pc-line");
    if (addressName) addressName.textContent = config.name;

    message.addEventListener("input", () => {
      if (message.getAttribute("aria-invalid")) {
        message.removeAttribute("aria-invalid");
        setPostcardNote(defaultNote, false);
      }
      $("posted").classList.remove("is-on");
    });

    $("postcard-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const text = message.value.trim();
      const name = from.value.trim().replace(/\s+/g, " ");

      if (!text) {
        message.setAttribute("aria-invalid", "true");
        setPostcardNote("Write something first, even just a hi.", true);
        message.focus();
        return;
      }

      const sender = name || visitor.company || "someone in " + visitor.place;
      const mail = buildPostcardMail(config.email, "A postcard from " + sender, text, name, visitor.place);
      setPostcardNote(mail.trimmed
        ? "That was a long one, so I trimmed the end to fit in an email link. Paste the rest in before you send."
        : defaultNote, false);

      slamPostedStamp();
      setTimeout(() => {
        window.location.href = mail.href;
        toast("Your email app has it from here.");
      }, reducedMotion() ? 0 : 450);
    });
  }

  /* 14. Socials ---------------------------------------------------------- */

  function renderSocials(config) {
    const list = $("socials");
    list.textContent = "";
    config.socials.forEach((social) => {
      list.append(el("li", null, externalLink(social.url, social.label, "me")));
    });
    list.closest(".find-me").hidden = config.socials.length === 0;
  }

  /* 15. Shortcuts menu --------------------------------------------------- */

  const palette = { commands: [], shown: [], active: 0, returnTo: null, pending: null };

  function goToSection(id, focusTarget) {
    const section = $(id);
    if (!section) return;
    section.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    const target = focusTarget || section.querySelector("h2");
    if (!target) return;
    if (!focusTarget) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  }

  function buildCommands(config, visitor) {
    const commands = [
      { label: "Write a postcard", hint: "Say hello", run: () => goToSection("hi", $("pc-message")) },
      { label: "Email " + config.firstName, hint: "Opens your email app", run: () => { window.location.href = mailtoLink(config.email, emailSubject(config, visitor)); } },
      { label: "Copy email address", hint: config.email, run: () => copyEmail(config.email) },
      { label: "Save contact", hint: "Downloads a contact card", keywords: "vcard vcf address book", run: () => $("vcard-btn").click() },
      { label: "See projects", hint: "Things I’ve built", run: () => goToSection("work") },
      { label: "Recruiter questions", hint: "FAQ", run: () => goToSection("faq") },
      { label: "Education", hint: "BCA, 2022 to 2025", run: () => goToSection("edu") },
      { label: "Switch color theme", hint: "", keywords: "dark light auto mode", run: cycleTheme }
    ];
    if (config.resume) {
      commands.push({ label: "Download resume", hint: "Opens in a new tab", run: () => window.open(config.resume, "_blank", "noopener") });
    }
    config.socials.forEach((social) => {
      commands.push({ label: "Open " + social.label, hint: "Opens in a new tab", run: () => window.open(social.url, "_blank", "noopener") });
    });
    return commands;
  }

  function themeHint() {
    return "Now " + THEME_NAMES[currentTheme] + ", next " + THEME_NAMES[THEMES[(THEMES.indexOf(currentTheme) + 1) % THEMES.length]];
  }

  function setActiveOption(index) {
    const list = $("palette-list");
    const input = $("palette-input");
    palette.active = index;
    list.querySelectorAll("[role=option]").forEach((option, i) => {
      option.setAttribute("aria-selected", i === index ? "true" : "false");
    });
    const current = $("palette-opt-" + index);
    if (current) {
      input.setAttribute("aria-activedescendant", current.id);
      current.scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function renderPalette() {
    const query = $("palette-input").value.trim().toLowerCase();
    const words = query.split(/\s+/).filter(Boolean);
    palette.shown = palette.commands.filter((command) => {
      const haystack = (command.label + " " + command.hint + " " + (command.keywords || "")).toLowerCase();
      return words.every((word) => haystack.indexOf(word) !== -1);
    });

    const list = $("palette-list");
    list.textContent = "";
    palette.shown.forEach((command, index) => {
      const hint = command.run === cycleTheme ? themeHint() : command.hint;
      const option = el("li", { className: "palette-option", id: "palette-opt-" + index, role: "option", "aria-selected": "false", "aria-label": hint ? command.label + ", " + hint : null }, [
        el("span", { className: "palette-option-label", text: command.label }),
        hint ? el("span", { className: "palette-option-hint", text: hint }) : null
      ]);
      option.addEventListener("click", () => runCommand(index));
      option.addEventListener("pointermove", () => {
        if (palette.active !== index) setActiveOption(index);
      });
      list.append(option);
    });

    $("palette-empty").hidden = palette.shown.length > 0;
    list.hidden = palette.shown.length === 0;
    setActiveOption(palette.shown.length ? Math.min(palette.active, palette.shown.length - 1) : -1);
  }

  function openPalette() {
    const dialog = $("palette");
    if (dialog.open) return;
    hideTip();
    palette.returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    palette.pending = null;
    palette.active = 0;
    $("palette-input").value = "";
    renderPalette();
    dialog.showModal();
    $("palette-input").focus();
  }

  function closePalette() {
    const dialog = $("palette");
    if (dialog.open) dialog.close();
  }

  function runCommand(index) {
    const command = palette.shown[index];
    if (!command) return;
    palette.pending = command;
    closePalette();
  }

  function isTypingTarget(target) {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    if (target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true;
    if (target.tagName !== "INPUT") return false;
    return ["button", "checkbox", "radio", "range", "submit", "reset", "color", "file"].indexOf(target.type) === -1;
  }

  function initPalette(config, visitor) {
    const dialog = $("palette");
    const input = $("palette-input");
    const button = $("shortcuts-btn");

    if (typeof dialog.showModal !== "function") {
      button.hidden = true;
      return;
    }

    palette.commands = buildCommands(config, visitor);
    button.addEventListener("click", openPalette);

    input.addEventListener("input", () => {
      palette.active = 0;
      renderPalette();
    });

    input.addEventListener("keydown", (event) => {
      const count = palette.shown.length;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!count) return;
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActiveOption((palette.active + step + count) % count);
      } else if (event.key === "Home" && count && !input.value) {
        event.preventDefault();
        setActiveOption(0);
      } else if (event.key === "End" && count && !input.value) {
        event.preventDefault();
        setActiveOption(count - 1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        runCommand(palette.active);
      }
    });

    // A click on the dark backdrop (outside the box) closes the menu.
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closePalette();
    });

    // Focus goes back where it was, then the chosen command runs.
    dialog.addEventListener("close", () => {
      const command = palette.pending;
      palette.pending = null;
      if (palette.returnTo && document.contains(palette.returnTo)) palette.returnTo.focus({ preventScroll: true });
      if (command) command.run();
    });

    document.addEventListener("keydown", (event) => {
      if (event.defaultPrevented || event.isComposing) return;
      const isK = event.key === "k" || event.key === "K";
      if (isK && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        if (dialog.open) closePalette();
        else openPalette();
      } else if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !isTypingTarget(event.target) && !dialog.open) {
        event.preventDefault();
        openPalette();
      }
    });
  }

  /* 16. Navigation highlight, progress line, tab title, idle note ------- */

  function initActiveNav() {
    const links = {};
    document.querySelectorAll(".topnav a").forEach((link) => {
      links[link.getAttribute("href").slice(1)] = link;
    });
    const sections = Array.from(document.querySelectorAll("main > section"));
    if (!("IntersectionObserver" in window)) return;

    const inBand = new Set();
    function update() {
      // The current section is the last one in page order crossing a thin band near the middle of the screen.
      const current = sections.filter((section) => inBand.has(section)).pop();
      const key = current ? current.getAttribute("data-nav") : null;
      Object.keys(links).forEach((id) => {
        if (id === key) links[id].setAttribute("aria-current", "true");
        else links[id].removeAttribute("aria-current");
      });
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) inBand.add(entry.target);
        else inBand.delete(entry.target);
      });
      update();
    }, { rootMargin: "-38% 0px -58% 0px" });
    sections.forEach((section) => observer.observe(section));
  }

  function initProgress() {
    const bar = $("progress-bar");
    let frame = 0;
    function draw() {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      bar.style.transform = "scaleX(" + ratio.toFixed(4) + ")";
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    draw();
  }

  function initTabTitle() {
    const title = document.title;
    document.addEventListener("visibilitychange", () => {
      document.title = document.hidden ? HIDDEN_TITLE : title;
    });
  }

  // After 40 quiet seconds, one gentle note. Once per visit.
  function initIdleNote() {
    if (store.get("idle-noted", "session")) return;
    const events = ["pointermove", "pointerdown", "scroll", "keydown", "touchstart", "wheel"];
    let timer = 0;

    function fire() {
      if (document.hidden || $("palette").open) {
        reset();
        return;
      }
      events.forEach((name) => window.removeEventListener(name, reset));
      store.set("idle-noted", "1", "session");
      toast("Take your time. I’ll be here.", 4000);
    }

    function reset() {
      clearTimeout(timer);
      timer = setTimeout(fire, IDLE_MS);
    }

    events.forEach((name) => window.addEventListener(name, reset, { passive: true }));
    reset();
  }

  let toastTimer = 0;
  let toastClear = 0;

  function toast(message, duration) {
    const box = $("toast");
    clearTimeout(toastTimer);
    clearTimeout(toastClear);
    box.textContent = "";
    // A fresh frame makes screen readers announce the message even if it repeats.
    requestAnimationFrame(() => {
      box.textContent = message;
      box.classList.add("is-shown");
      toastTimer = setTimeout(() => {
        box.classList.remove("is-shown");
        toastClear = setTimeout(() => {
          box.textContent = "";
        }, 400);
      }, duration || 2800);
    });
  }

  // Keeps the canonical link in step with siteUrl from config.js.
  function syncCanonical(config) {
    if (!config.siteUrl) return;
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical && canonical.getAttribute("href") !== config.siteUrl) canonical.setAttribute("href", config.siteUrl);
    const ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl) ogUrl.setAttribute("content", config.siteUrl);
  }

  /* 17. Start ------------------------------------------------------------ */

  // Each part runs on its own, so a problem in one never stops the others.
  function safely(name, task) {
    try {
      task();
    } catch (error) {
      console.error("[main.js] " + name + " failed:", error);
    }
  }

  function start() {
    const config = readConfig(window.SITE_CONFIG);
    const visitor = detectVisitor();

    safely("theme", initTheme);
    safely("canonical", () => syncCanonical(config));
    safely("name", () => {
      document.querySelector("[data-brand]").textContent = config.name;
      $("hero-name").textContent = config.name;
    });
    safely("greeting", () => {
      renderGreeting(visitor);
      initTooltips();
    });
    safely("clocks", () => startClocks(visitor, () => {
      const reach = $("reach-line");
      if (reach) reach.textContent = reachLine();
    }));
    safely("about", () => {
      $("about-line").textContent = aboutLine(visitor);
    });
    safely("now", () => renderNow(config));
    safely("projects", () => renderProjects(config, visitor));
    safely("faq", () => renderFaq(config, visitor));
    safely("postcard", () => initPostcard(config, visitor));
    safely("socials", () => renderSocials(config));
    safely("shortcuts", () => initPalette(config, visitor));
    safely("navigation", initActiveNav);
    safely("progress", initProgress);
    safely("title", initTabTitle);
    safely("idle", initIdleNote);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
