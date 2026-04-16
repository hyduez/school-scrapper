// [STEM-SCRAPER] Background Service Worker - Optimized Crawler

let crawlQueue = [];
let visitedUrls = new Set();
let isCrawling = false;
let currentDomain = "";
let currentUrl = "";
let maxPages = 120;
let workerTabId = null;

// Initialize state
chrome.storage.local.get(
    ["crawlQueue", "visitedUrls", "isCrawling", "currentDomain", "currentUrl"],
    (res) => {
        if (res.crawlQueue) crawlQueue = res.crawlQueue;
        if (res.visitedUrls) visitedUrls = new Set(res.visitedUrls);
        if (res.isCrawling) isCrawling = res.isCrawling;
        if (res.currentDomain) currentDomain = res.currentDomain;
        if (res.currentUrl) currentUrl = res.currentUrl;
    },
);

const saveState = () => {
    chrome.storage.local.set({
        crawlQueue,
        visitedUrls: Array.from(visitedUrls),
        isCrawling,
        currentDomain,
        currentUrl,
    });
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "START_CRAWL") {
        currentDomain = new URL(message.startUrl).hostname;
        crawlQueue = [message.startUrl];
        visitedUrls.clear();
        isCrawling = true;
        saveState();
        startCrawlerLoop();
        sendResponse({ status: "started" });
    } else if (message.action === "PAUSE_CRAWL") {
        isCrawling = false;
        saveState();
        sendResponse({ status: "paused" });
    } else if (message.action === "RESUME_CRAWL") {
        isCrawling = true;
        saveState();
        startCrawlerLoop();
        sendResponse({ status: "resumed" });
    } else if (message.action === "CLEAR_DATA") {
        isCrawling = false;
        crawlQueue = [];
        visitedUrls.clear();
        currentDomain = "";
        currentUrl = "";
        chrome.storage.local.set({
            teachers: [],
            crawlQueue: [],
            visitedUrls: [],
            isCrawling: false,
            currentDomain: "",
            currentUrl: "",
        });
        sendResponse({ status: "cleared" });
    } else if (message.action === "GET_STATUS") {
        sendResponse({
            isCrawling,
            queueLength: crawlQueue.length,
            visitedCount: visitedUrls.size,
            currentDomain,
            currentUrl,
        });
    }
});

async function startCrawlerLoop() {
    if (!isCrawling) return;

    while (isCrawling && crawlQueue.length > 0 && visitedUrls.size < maxPages) {
        // Sort queue by priority occasionally or just pick the best one
        sortQueue();
        const url = crawlQueue.shift();

        if (visitedUrls.has(url)) continue;
        visitedUrls.add(url);
        currentUrl = url;
        saveState();

        console.log(`[STEM-SCRAPER] Crawling (${visitedUrls.size}/${maxPages}): ${url}`);

        try {
            const delay = Math.floor(Math.random() * (2000 - 800 + 1)) + 800;
            await new Promise(r => setTimeout(r, delay));

            if (!isCrawling) break;

            // Tab Reuse Logic
            if (workerTabId === null) {
                workerTabId = await createWorkerTab(url);
            } else {
                try {
                    await updateWorkerTab(workerTabId, url);
                } catch (e) {
                    // If tab was closed by user, recreate it
                    workerTabId = await createWorkerTab(url);
                }
            }

            // Wait for JS to execute
            await new Promise(r => setTimeout(r, 2000));

            const result = await new Promise((resolve) => {
                chrome.tabs.sendMessage(workerTabId, { action: "SCAN_PAGE", domain: currentDomain }, (res) => {
                    if (chrome.runtime.lastError) resolve(null);
                    else resolve(res);
                });
            });

            if (result) {
                await processScanResults(result, url);
            }
        } catch (error) {
            console.error(`[STEM-SCRAPER] Error on ${url}:`, error);
        }
    }

    if (visitedUrls.size >= maxPages || (isCrawling && crawlQueue.length === 0)) {
        isCrawling = false;
        currentUrl = "Finished";
        if (workerTabId) {
            chrome.tabs.remove(workerTabId).catch(() => {});
            workerTabId = null;
        }
        saveState();
        console.log("[STEM-SCRAPER] Crawl finished.");
    }
}

function createWorkerTab(url) {
    return new Promise((resolve) => {
        chrome.tabs.create({ url, active: false }, (tab) => {
            const listener = (tId, info) => {
                if (tId === tab.id && info.status === "complete") {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve(tab.id);
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
        });
    });
}

function updateWorkerTab(tabId, url) {
    return new Promise((resolve, reject) => {
        chrome.tabs.update(tabId, { url }, (tab) => {
            if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
            const listener = (tId, info) => {
                if (tId === tab.id && info.status === "complete") {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve(tab.id);
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
        });
    });
}

const HIGH_PRIORITY = ['directory', 'staff', 'faculty', 'teacher', 'people', 'department'];
const MEDIUM_PRIORITY = ['math', 'science', 'stem', 'technology', 'engineering', 'about', 'contact', 'academics'];

function sortQueue() {
    crawlQueue.sort((a, b) => {
        const aLower = a.toLowerCase();
        const bLower = b.toLowerCase();
        
        const getScore = (url) => {
            if (HIGH_PRIORITY.some(kw => url.includes(kw))) return 2;
            if (MEDIUM_PRIORITY.some(kw => url.includes(kw))) return 1;
            return 0;
        };

        return getScore(bLower) - getScore(aLower);
    });
}

async function processScanResults(result, pageUrl) {
    const { teachers, links } = result;

    // Enqueue new links
    links.forEach((link) => {
        try {
            const urlObj = new URL(link);
            urlObj.hash = ""; // Remove hashes
            const cleanUrl = urlObj.href;

            if (
                urlObj.hostname === currentDomain &&
                !visitedUrls.has(cleanUrl) &&
                !crawlQueue.includes(cleanUrl)
            ) {
                const lower = cleanUrl.toLowerCase();
                if (lower.match(/\.(pdf|jpg|png|doc|docx|xls|xlsx|zip|mp4|mov|jpeg|gif)$/i)) return;
                
                // Only keep links that seem relevant to save space and time
                if (HIGH_PRIORITY.concat(MEDIUM_PRIORITY).some(kw => lower.includes(kw)) || visitedUrls.size < 20) {
                    crawlQueue.push(cleanUrl);
                }
            }
        } catch (e) {}
    });

    if (teachers && teachers.length > 0) {
        chrome.storage.local.get(["teachers"], (res) => {
            const existing = res.teachers || [];
            const existingEmails = new Set(existing.map((t) => t.Email.toLowerCase()));
            let added = 0;

            teachers.forEach((t) => {
                if (!existingEmails.has(t.Email.toLowerCase())) {
                    t.PageURL = pageUrl;
                    t.CrawledAt = new Date().toISOString();
                    existing.push(t);
                    existingEmails.add(t.Email.toLowerCase());
                    added++;
                }
            });

            if (added > 0) chrome.storage.local.set({ teachers: existing });
        });
    }
}
