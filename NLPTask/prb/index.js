import { writeFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { connect } from "puppeteer-real-browser";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_JSON = join(__dirname, "article_links.json");
const ARTICLES_JSON = join(__dirname, "articles.json");

let page;

const RETRIES_ON_ERROR = 3;
const TIMEOUT = 25000;
const MAX_CONTENT_WORDS_LENGTH = 1000;

const URLS = [
    { site: "benzinga", url: "https://www.benzinga.com/search?q=XAU-USD" },
    { site: "investing", url: "https://www.investing.com/currencies/xau-usd-news" },
    { site: "yahoo", url: "https://finance.yahoo.com/quote/GLD/" },
];

const KEYWORDS = [
    "xauusd",
    "gold",
    "silver",
    "usd",
    "xau",
    "forex",
    "currency",
];

const WITH_KEYWORDS = process.argv.includes("--with-keywords");

const matchesKeywords = (...texts) => {
    const haystack = texts.filter(Boolean).join(" ").toLowerCase();
    return KEYWORDS.some((keyword) => haystack.includes(keyword.toLowerCase()));
};

const dedupeUrls = (urls) => [...new Set(urls.filter(Boolean))];

// Boilerplate fragments stripped from scraped article bodies.
const ARTICLE_BODY_CLEANUPS = [
    /©\s*\d{4}\s*Benzinga\.com\. Benzinga does not provide investment advice\. All rights reserved\.\s*\n*\s*To add Benzinga News as your preferred source on Google,\s*\./gi,
    /This article first appeared on \.\s*\n*/gi,
];

const cleanArticleBody = (text) => {
    if (!text) return text;
    let out = text;
    for (const re of ARTICLE_BODY_CLEANUPS) {
        out = out.replace(re, "");
    }
    return out.trim();
};

const optimizePageLoad = async (targetPage) => {
    await targetPage.setRequestInterception(true);
    targetPage.on("request", (req) => {
        const type = req.resourceType();
        if (["image", "stylesheet", "font", "media"].includes(type)) {
            req.abort();
        } else {
            req.continue();
        }
    });
};

const fetchLinksForSite = async (site, page) => {
    await page.goto(site.url, { timeout: TIMEOUT, waitUntil: "domcontentloaded" });

    switch (site.site) {
        case "benzinga": {
            await page
                .waitForSelector("a.post-card-article-link", { timeout: TIMEOUT })
                .catch(() => null);
            return await page.$$eval("a.post-card-article-link", (anchors) =>
                anchors.map((a) => a.href).filter(Boolean)
            );
        }
        case "investing": {
            const articles = await page.$$("article[data-test='article-item']");
            const investing_articles_links = [];
            for (const article of articles) {
                const href = await article.$eval("a", (a) => a.href).catch(() => null);
                if (href) investing_articles_links.push(href);
            }
            return investing_articles_links;
        }
        case "yahoo": {
            await page.waitForSelector("section[data-testid='recent-news']", {
                timeout: TIMEOUT,
            });

            await page.evaluate(() => {
                document
                    .querySelector("section[data-testid='recent-news']")
                    ?.scrollIntoView();
            });
            await page
                .waitForSelector(
                    "section[data-testid='recent-news'] section[data-testid='storyitem'] a[href*='/articles/']",
                    { timeout: TIMEOUT }
                )
                .catch(() => null);

            return await page.$$eval(
                "section[data-testid='recent-news'] section[data-testid='storyitem']",
                (items) =>
                    items
                        .filter((item) => !item.querySelector("a[href*='/topic/premium-news/']"))
                        .map((item) => item.querySelector("a[href*='/articles/']")?.href)
                        .filter(Boolean)
            );
        }
        default:
            throw new Error(`Unknown site: ${site.site}`);
    }
};

const scrapeSiteLinks = async (site) => {
    let lastError;

    for (let attempt = 1; attempt <= RETRIES_ON_ERROR; attempt++) {
        let browser;
        try {
            const { browser: b, page: p } = await connect({
                headless: false,
                args: [],
                customConfig: {},
                turnstile: true,
                connectOption: {},
                disableXvfb: true,
                ignoreAllFlags: false,
            });
            browser = b;
            await optimizePageLoad(p);

            const links = dedupeUrls(await fetchLinksForSite(site, p));
            await browser.close();
            console.log(`[${site.site}] ${links.length} links`);
            return links;
        } catch (error) {
            lastError = error;
            console.error(
                `[${site.site}] links attempt ${attempt}/${RETRIES_ON_ERROR} failed:`,
                error.message
            );
            if (browser) {
                await browser.close().catch(() => {});
            }
        }
    }

    console.error(`[${site.site}] links gave up after ${RETRIES_ON_ERROR} attempts:`, lastError?.message);
    return [];
};

const fetchArticleContent = async (site, link) => {
    await page.goto(link, { timeout: TIMEOUT, waitUntil: "domcontentloaded" });

    return await page.evaluate((currentSite, maxWords) => {
        const limitWordsInline = (text, max) => {
            if (!text) return "";
            const w = text.split(/\s+/).filter(Boolean);
            return w.length <= max ? text : w.slice(0, max).join(" ");
        };

        let title = "Unknown Title";
        let bodyText = "";
        let date = "Unknown Date";
        let author = "Unknown Author";

        try {
            switch (currentSite) {
                case "benzinga": {
                    const titleEl = document.querySelector("h2.article-title");
                    if (titleEl) title = titleEl.innerText.trim();

                    const bodyEl = document.querySelector("#article-body");
                    if (bodyEl) {
                        bodyEl.querySelectorAll("a").forEach((el) => el.remove());
                        bodyText = limitWordsInline(bodyEl.innerText.trim(), maxWords);
                    }

                    const dateEl = document.querySelector("span.article-date");
                    if (dateEl) date = dateEl.innerText.trim();

                    const authorEl = document.querySelector("a.author-name");
                    if (authorEl) author = authorEl.innerText.trim();
                    break;
                }
                case "investing": {
                    const titleEl = document.querySelector("#articleTitle");
                    if (titleEl) title = titleEl.innerText.trim();

                    const bodyEl = document.querySelector("#article");
                    if (bodyEl) {
                        bodyEl.querySelectorAll("a").forEach((el) => el.remove());
                        bodyText = limitWordsInline(bodyEl.innerText.trim(), maxWords);
                    }

                    const spans = Array.from(document.querySelectorAll("span"));
                    const pubSpan = spans.find((s) => s.innerText && s.innerText.includes("Published"));
                    if (pubSpan && pubSpan.nextElementSibling) {
                        date = pubSpan.nextElementSibling.innerText.trim();
                    }
                    author = "Investing.com Staff";
                    break;
                }
                case "yahoo": {
                    const titleEl = document.querySelector("h1.cover-title");
                    if (titleEl) title = titleEl.innerText.trim();

                    const bodyEl = document.querySelector("div[data-testid='article-body']");
                    if (bodyEl) {
                        bodyEl.querySelectorAll("a").forEach((el) => el.remove());
                        bodyText = limitWordsInline(bodyEl.innerText.trim(), maxWords);
                    }

                    const dateEl = document.querySelector("time.byline-attr-meta-time");
                    if (dateEl) date = dateEl.innerText.trim();

                    const authorEl = document.querySelector("div.byline-attr-author");
                    if (authorEl) author = authorEl.innerText.trim();
                    break;
                }
            }
        } catch (e) {
            // Keep going even if parsing metadata fails slightly
        }

        return { title, article_body_text: bodyText, article_date: date, article_author: author };
    }, site, MAX_CONTENT_WORDS_LENGTH);
};

const scrapeSiteArticles = async (site, links) => {
    if (links.length === 0) {
        return [];
    }

    let lastError;

    for (let attempt = 1; attempt <= RETRIES_ON_ERROR; attempt++) {
        let browser;
        const articles = [];
        try {
            const { browser: b, page: p } = await connect({
                headless: false,
                args: [],
                customConfig: {},
                turnstile: true,
                connectOption: {},
                disableXvfb: true,
                ignoreAllFlags: false,
            });
            browser = b;
            page = p;
            await optimizePageLoad(page);

            let skipped = 0;
            for (const url of links) {
                try {
                    const cleanData = await fetchArticleContent(site, url);
                    if (!cleanData) continue;

                    const title = cleanData.title;
                    const body = cleanArticleBody(cleanData.article_body_text);

                    if (WITH_KEYWORDS && !matchesKeywords(title, body)) {
                        skipped += 1;
                        console.log(`[${site}] skipped (no keyword in headline/body): ${url}`);
                        continue;
                    }

                    articles.push({
                        url,
                        title,
                        body,
                        date: cleanData.article_date,
                        author: cleanData.article_author,
                    });
                    console.log(`[${site}] article ${articles.length}/${links.length}`);
                } catch (err) {
                    console.error(`[${site}] article failed ${url}:`, err.message);
                }
            }

            if (WITH_KEYWORDS && skipped) {
                console.log(`[${site}] skipped ${skipped} articles (no keyword in headline/body)`);
            }

            await browser.close();
            return articles;
        } catch (error) {
            lastError = error;
            console.error(
                `[${site}] articles attempt ${attempt}/${RETRIES_ON_ERROR} failed:`,
                error.message
            );
            if (browser) {
                await browser.close().catch(() => {});
            }
        }
    }

    console.error(`[${site}] articles gave up after ${RETRIES_ON_ERROR} attempts:`, lastError?.message);
    return [];
};

const scrapedAt = new Date().toISOString();

if (WITH_KEYWORDS) {
    console.log("Keyword filter enabled:", KEYWORDS.join(", "));
}

console.log("=== Phase 1: fetching article links ===");
const linkResults = [];
for (const site of URLS) {
    const links = await scrapeSiteLinks(site);
    linkResults.push({
        site: site.site,
        source_url: site.url,
        links,
    });
}

const linksOutput = { scraped_at: scrapedAt, sites: linkResults };
await writeFile(OUTPUT_JSON, JSON.stringify(linksOutput, null, 2) + "\n", "utf-8");

const totalLinks = linkResults.reduce((n, s) => n + s.links.length, 0);
console.log(`[saved] ${OUTPUT_JSON} (${totalLinks} links)`);

console.log("=== Phase 2: fetching article content ===");
const articleResults = [];
for (const { site, links } of linkResults) {
    const articles = await scrapeSiteArticles(site, links);
    articleResults.push({ site, articles });
}

const articlesOutput = { scraped_at: scrapedAt, sites: articleResults };
await writeFile(ARTICLES_JSON, JSON.stringify(articlesOutput, null, 2) + "\n", "utf-8");

const totalArticles = articleResults.reduce((n, s) => n + s.articles.length, 0);
console.log(`[saved] ${ARTICLES_JSON} (${totalArticles} articles)`);
