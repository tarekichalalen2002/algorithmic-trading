import { connect } from "puppeteer-real-browser";

const PROXIES = [
    "gate.decodo.com:10001:sp9ykl4gky:qggR2ox6My1~rgr7QX",
    "gate.decodo.com:10002:sp9ykl4gky:qggR2ox6My1~rgr7QX",
    "gate.decodo.com:10003:sp9ykl4gky:qggR2ox6My1~rgr7QX",
    "gate.decodo.com:10004:sp9ykl4gky:qggR2ox6My1~rgr7QX",
    "gate.decodo.com:10005:sp9ykl4gky:qggR2ox6My1~rgr7QX",
    "gate.decodo.com:10006:sp9ykl4gky:qggR2ox6My1~rgr7QX",
    "gate.decodo.com:10007:sp9ykl4gky:qggR2ox6My1~rgr7QX",
    "gate.decodo.com:10008:sp9ykl4gky:qggR2ox6My1~rgr7QX",
    "gate.decodo.com:10009:sp9ykl4gky:qggR2ox6My1~rgr7QX",
    "gate.decodo.com:10010:sp9ykl4gky:qggR2ox6My1~rgr7QX",
];

const parseProxy = (line) => {
    const [host, port, username, password] = line.split(":");
    return { host, port: Number(port), username, password };
};

// IP as seen with NO proxy, for comparison.
const directIp = async () => {
    try {
        const res = await fetch("https://api.ipify.org?format=json");
        const { ip } = await res.json();
        return ip;
    } catch (err) {
        return `(direct check failed: ${err.message})`;
    }
};

const proxiedIp = async (proxy) => {
    let browser;
    try {
        const conn = await connect({
            headless: false,
            args: [],
            customConfig: {},
            turnstile: true,
            connectOption: {},
            disableXvfb: true,
            ignoreAllFlags: false,
            proxy,
        });
        browser = conn.browser;
        const { page } = conn;
        page.setDefaultNavigationTimeout(45000);
        await page.goto("https://api.ipify.org?format=json", { waitUntil: "domcontentloaded" });
        const text = await page.evaluate(() => document.body?.innerText || "");
        await browser.close();
        return text.trim();
    } catch (err) {
        if (browser) await browser.close().catch(() => {});
        return `(error: ${err.message})`;
    }
};

console.log(`[direct] no-proxy IP: ${await directIp()}`);
console.log("--- testing each proxy port (exit IP it produces) ---");
for (const line of PROXIES) {
    const proxy = parseProxy(line);
    const ip = await proxiedIp(proxy);
    console.log(`[${proxy.host}:${proxy.port}] -> ${ip}`);
}
console.log("--- done ---");
process.exit(0);