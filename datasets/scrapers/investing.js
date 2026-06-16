import { readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { connect } from "puppeteer-real-browser";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INVESTING_CSV_PATH = join(__dirname, "..", "data", "by_domain", "investing.com.csv");

const NAV_TIMEOUT = 60000;
const BODY_TIMEOUT = 5000; // short: empty articles shouldn't stall the run
const MAX_CONTENT_WORDS_LENGTH = 1000;

// investing.com pages don't need auth, but blocking heavy assets still speeds things up.
const setupRequestInterception = async (page) => {
    await page.setRequestInterception(true);
    page.on("request", (req) => {
        const type = req.resourceType();
        if (["image", "stylesheet", "font", "media"].includes(type)) {
            req.abort();
        } else {
            req.continue();
        }
    });
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

// --- Article body extraction (investing.com, adapted from finBERT/prb/index.js) ---

const extractArticleBody = async (page, url) => {
    await page.goto(url, { timeout: NAV_TIMEOUT, waitUntil: "domcontentloaded" });

    // Wait for the article body; if it never appears once the page settles, it's empty.
    const found = await page
        .waitForSelector("#article", { timeout: BODY_TIMEOUT })
        .catch(() => null);
    if (!found) return "empty";

    const body = await page.evaluate((maxWords) => {
        const limitWordsInline = (text, max) => {
            if (!text) return "";
            const w = text.split(/\s+/).filter(Boolean);
            return w.length <= max ? text : w.slice(0, max).join(" ");
        };

        const bodyEl = document.querySelector("#article");
        if (!bodyEl) return "";
        bodyEl.querySelectorAll("a").forEach((el) => el.remove());
        return limitWordsInline(bodyEl.innerText.trim(), maxWords);
    }, MAX_CONTENT_WORDS_LENGTH);

    return body.trim() || "empty";
};

// --- Main: one browser, no login, scrape investing.com articles ---

const { browser, page } = await connect({
    headless: false,
    args: [],
    customConfig: {},
    turnstile: true,
    connectOption: {},
    disableXvfb: true,
    ignoreAllFlags: false,
});

page.setDefaultTimeout(NAV_TIMEOUT);
page.setDefaultNavigationTimeout(NAV_TIMEOUT);
await setupRequestInterception(page);

// Load CSV, ensure the article_body column exists.
const rows = parseCsv(await readFile(INVESTING_CSV_PATH, "utf-8"));
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
    await writeFile(INVESTING_CSV_PATH, serializeCsv(header, dataRows), "utf-8");
};

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

    try {
        const body = await extractArticleBody(page, url);
        row[bodyIndex] = body;
        console.log(
            `[article ${i + 1}/${dataRows.length}] ${body === "empty" ? "empty" : body.length + " chars"}`
        );
    } catch (err) {
        console.error(`[article ${i + 1}] failed ${url}:`, err.message);
        continue; // leave unmarked so it retries on the next run
    }

    processed++;
    if (processed % SAVE_EVERY === 0) {
        await save();
        console.log(`[saved] after ${processed} extractions`);
    }
}

await save();
console.log(`[done] saved ${INVESTING_CSV_PATH}`);

await browser.close();
