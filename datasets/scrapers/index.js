import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { connect } from "puppeteer-real-browser";

const MARKETWATCH_EMAIL = "ichalalentarek@gmail.com";
const MARKETWATCH_PWD = "MarketWatch@2026";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MARKETWATCH_CSV_PATH = join(__dirname, "..", "data", "by_domain", "marketwatch.com.csv");

// const PROXIES = [
//     "gate.decodo.com:10001:user-sp9ykl4gky-continent-na:qggR2ox6My1~rgr7QX",
//     "gate.decodo.com:10002:user-sp9ykl4gky-continent-na:qggR2ox6My1~rgr7QX",
//     "gate.decodo.com:10003:user-sp9ykl4gky-continent-na:qggR2ox6My1~rgr7QX",
//     "gate.decodo.com:10004:user-sp9ykl4gky-continent-na:qggR2ox6My1~rgr7QX",
//     "gate.decodo.com:10005:user-sp9ykl4gky-continent-na:qggR2ox6My1~rgr7QX",
//     "gate.decodo.com:10006:user-sp9ykl4gky-continent-na:qggR2ox6My1~rgr7QX",
//     "gate.decodo.com:10007:user-sp9ykl4gky-continent-na:qggR2ox6My1~rgr7QX",
//     "gate.decodo.com:10008:user-sp9ykl4gky-continent-na:qggR2ox6My1~rgr7QX",
//     "gate.decodo.com:10009:user-sp9ykl4gky-continent-na:qggR2ox6My1~rgr7QX",
//     "gate.decodo.com:10010:user-sp9ykl4gky-continent-na:qggR2ox6My1~rgr7QX",
// ]



// "host:port:username:password" -> { host, port, username, password }
// const parseProxy = (line) => {
//     const [host, port, username, password] = line.split(":");
//     return { host, port: Number(port), username, password };
// };

// const pickProxy = () => parseProxy(PROXIES[Math.floor(Math.random() * PROXIES.length)]);

// Persistent profile dir so login + scraping share one consistent session.
const SESSION_DIR = join(__dirname, ".session");

const LOGIN_URL =
    "https://sso.accounts.dowjones.com/login-page?response_type=code&client_id=mXLcqvTH2XErOHujifdNH7dntWdZqvGFl9J3s3aH&redirect_uri=https%3A%2F%2Fwww.marketwatch.com%2Fclient%2Fauth&scope=openid+idp_id+roles+tags+email+given_name+family_name+uuid+djid+djUsername+djStatus+trackid+prts+updated_at+created_at+offline_access+group&ui_locales=en-us-x-mw-223-2&nonce=d9e9a9e5-3cdd-4f9b-831e-894cfd34a19b&state=NfLB0PjXGH5mQ1XD.ERW7dLmRzDDYqeZNUxR_ovAmEoUYVkiZLSCBNRAWPdE&device_id=e696b1b1-f365-4dec-9be5-5e9403199902&protocol=oauth2&client=mXLcqvTH2XErOHujifdNH7dntWdZqvGFl9J3s3aH&resource=https%253A%252F%252Fwww.marketwatch.com%252F#/signin"

const TIMEOUT = 25000;
const NAV_TIMEOUT = 60000;
const PARAGRAPH_TIMEOUT = 5000; // short: empty articles shouldn't stall the run
const LOGIN_WAIT_TIMEOUT = 300000; // up to 5 min for manual captcha/2FA

// Toggled at runtime: login needs assets (captcha), scraping does not.
let blockAssets = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Set up request interception once; abort heavy assets only while scraping.
const setupRequestInterception = async (page) => {
    await page.setRequestInterception(true);
    page.on("request", (req) => {
        const type = req.resourceType();
        if (blockAssets && ["image", "stylesheet", "font", "media"].includes(type)) {
            req.abort();
        } else {
            req.continue();
        }
    });
};

// --- Login ---

const waitForAnySelector = async (page, selectors, timeout) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        for (const sel of selectors) {
            const el = await page.$(sel);
            if (el) return { selector: sel, element: el };
        }
        await sleep(500);
    }
    return null;
};

const typeInto = async (page, selectors, text) => {
    const found = await waitForAnySelector(page, selectors, 30000);
    if (!found) return false;
    await page.click(found.selector).catch(() => {});
    await page.type(found.selector, text, { delay: 40 });
    return true;
};

const clickAny = async (page, selectors) => {
    for (const sel of selectors) {
        const el = await page.$(sel);
        if (el) {
            await el.click().catch(() => {});
            return true;
        }
    }
    return false;
};

const isLoggedIn = (page) => {
    const url = page.url();
    return url.includes("marketwatch.com") && !url.includes("sso.accounts.dowjones.com");
};

const ensureLoggedIn = async (page) => {
    blockAssets = false; // login UI / captcha needs assets
    await page.goto(LOGIN_URL, { timeout: NAV_TIMEOUT, waitUntil: "domcontentloaded" });

    if (isLoggedIn(page)) {
        console.log("[login] already authenticated (session reused).");
        return true;
    }

    console.log("[login] entering email...");
    await typeInto(page, ['input[name="emailOrUsername"]', "#emailOrUsername-form-item"], MARKETWATCH_EMAIL);
    await clickAny(page, ["#signin-continue-btn", 'button[type="submit"]']);

    console.log("[login] waiting for password field...");
    const passwordField = await waitForAnySelector(
        page,
        ['input[name="password"]', "#password-form-item", 'input[type="password"]'],
        30000
    );
    if (!passwordField) {
        console.error("[login] password field never appeared.");
        return false;
    }

    console.log("[login] entering password...");
    await typeInto(page, ['input[name="password"]', "#password-form-item", 'input[type="password"]'], MARKETWATCH_PWD);
    await clickAny(page, ["#signin-pass-submit-btn", 'button[type="submit"]']);

    console.log("[login] waiting for redirect to marketwatch.com (finish any captcha/2FA in the window)...");
    const deadline = Date.now() + LOGIN_WAIT_TIMEOUT;
    while (Date.now() < deadline) {
        if (isLoggedIn(page)) {
            console.log(`[login] success: ${page.url()}`);
            return true;
        }
        await sleep(1000);
    }

    console.error("[login] timed out waiting for login to complete.");
    return false;
};

// --- CSV read/write (quote- and newline-aware) ---

const BODY_COLUMN = "article_body";
const SAVE_EVERY = 10;

// Full CSV parser: handles quoted fields that may contain commas, quotes, and newlines.
const parseCsv = (text) => {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += c;
            }
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ",") {
            row.push(field);
            field = "";
        } else if (c === "\n") {
            row.push(field);
            rows.push(row);
            row = [];
            field = "";
        } else if (c === "\r") {
            // ignore; \n handles the row break
        } else {
            field += c;
        }
    }
    if (field !== "" || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows;
};

const csvEscape = (value) => {
    const s = value == null ? "" : String(value);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const serializeCsv = (header, rows) =>
    [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n") + "\n";

// --- Article body extraction ---

const BLOCKED = Symbol("blocked");

const extractArticleBody = async (page, url) => {
    await page.goto(url, { timeout: NAV_TIMEOUT, waitUntil: "domcontentloaded" });

    // Bail out early if we hit the anti-bot wall so the caller can rotate proxy.
    if (await isBlocked(page)) return BLOCKED;

    // Wait for at least one paragraph; if none appears once the page settles, it's empty.
    const found = await page
        .waitForSelector('[data-testid="paragraph"]', { timeout: PARAGRAPH_TIMEOUT })
        .catch(() => null);
    if (!found) return "empty";

    const text = await page.$$eval('[data-testid="paragraph"]', (els) =>
        els.map((e) => e.innerText.trim()).filter(Boolean).join(" ")
    );
    return text.trim() || "empty";
};

// --- Block detection + exit-IP verification ---

// MarketWatch's anti-bot challenge page (the "Access is temporarily restricted" wall).
const isBlocked = async (page) => {
    try {
        const text = await page.evaluate(() =>
            document.body ? document.body.innerText.slice(0, 600) : ""
        );
        return /temporarily restricted|unusual activity|detected unusual|access denied/i.test(text);
    } catch {
        return false;
    }
};

// Confirm which IP the target actually sees (proves the proxy is in effect).
const verifyExitIp = async (page) => {
    try {
        await page.goto("https://api.ipify.org?format=json", {
            timeout: NAV_TIMEOUT,
            waitUntil: "domcontentloaded",
        });
        const ip = await page.evaluate(() => document.body?.innerText || "");
        console.log(`[exit ip] ${ip.trim()}`);
    } catch (err) {
        console.log(`[exit ip] check failed: ${err.message}`);
    }
};

// --- Human-like pacing ---

const MIN_DELAY = 1500;
const MAX_DELAY = 4500;
const randomDelay = () => MIN_DELAY + Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY));

// --- Main: rotating-proxy browser, login then scrape ---

await mkdir(SESSION_DIR, { recursive: true });

let browser;
let page;
let proxy;

const openBrowser = async () => {
    if (browser) await browser.close().catch(() => {});
    // proxy = pickProxy();
    // console.log(`[proxy] connecting via ${proxy.host}:${proxy.port}`);

    const conn = await connect({
        headless: false,
        args: [],
        customConfig: { userDataDir: SESSION_DIR },
        turnstile: true,
        connectOption: {},
        disableXvfb: true,
        ignoreAllFlags: false,
        // proxy,
    });
    browser = conn.browser;
    page = conn.page;

    page.setDefaultTimeout(NAV_TIMEOUT);
    page.setDefaultNavigationTimeout(NAV_TIMEOUT);
    await setupRequestInterception(page);
};

await openBrowser();

// Verify the proxy works and log the exit IP (assets allowed for this check).
blockAssets = false;
// await verifyExitIp(page);

await ensureLoggedIn(page);

// From here on, reuse the same authenticated page and block heavy assets.
blockAssets = true;

// Load CSV, ensure the article_body column exists.
const rows = parseCsv(await readFile(MARKETWATCH_CSV_PATH, "utf-8"));
const header = rows[0];
const dataRows = rows.slice(1);

const urlIndex = header.findIndex((h) => h.trim().toLowerCase() === "url");
if (urlIndex === -1) throw new Error("No URL column found in CSV");

let bodyIndex = header.findIndex((h) => h.trim().toLowerCase() === BODY_COLUMN);
if (bodyIndex === -1) {
    header.push(BODY_COLUMN);
    bodyIndex = header.length - 1;
}

const save = async () => {
    await writeFile(MARKETWATCH_CSV_PATH, serializeCsv(header, dataRows), "utf-8");
};

// const MAX_PROXY_ROTATIONS = PROXIES.length;

let processed = 0;
for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    while (row.length < header.length) row.push("");

    // Skip rows that already have a non-empty article_body.
    if (row[bodyIndex] && row[bodyIndex].trim()) continue;

    const url = (row[urlIndex] || "").trim();
    if (!url) {
        row[bodyIndex] = "empty";
        continue;
    }

    let body;
    let rotations = 0;
    try {
        // Retry the same URL through fresh proxies whenever we hit the bot wall.
        while (true) {
            body = await extractArticleBody(page, url);
            if (body !== BLOCKED) break;

            rotations++;
            console.warn(`[article ${i + 1}] blocked; rotating proxy (${rotations}/${MAX_PROXY_ROTATIONS})`);
            if (rotations >= MAX_PROXY_ROTATIONS) {
                console.error(`[article ${i + 1}] still blocked after rotating all proxies; leaving for next run`);
                break;
            }
            blockAssets = false;
            await openBrowser();
            // await verifyExitIp(page);
            blockAssets = true;
            await sleep(randomDelay());
        }
    } catch (err) {
        console.error(`[article ${i + 1}] failed ${url}:`, err.message);
        await sleep(randomDelay());
        continue; // leave unmarked so it retries on the next run
    }

    if (body === BLOCKED) {
        await sleep(randomDelay());
        continue; // couldn't get past the wall this run
    }

    row[bodyIndex] = body;
    console.log(
        `[article ${i + 1}/${dataRows.length}] ${body === "empty" ? "empty" : body.length + " chars"}`
    );

    processed++;
    if (processed % SAVE_EVERY === 0) {
        await save();
        console.log(`[saved] after ${processed} extractions`);
    }

    // Human-like pause between articles to avoid "rapid activity" detection.
    await sleep(randomDelay());
}

await save();
console.log(`[done] saved ${MARKETWATCH_CSV_PATH}`);

await browser.close();
