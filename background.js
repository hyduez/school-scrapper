// [STEM-SCRAPER] Background Service Worker - Hyper-Smart Crawler

let crawlQueue = [];
let visitedUrls = new Set();
let isCrawling = false;
let currentDomain = "";
let currentUrl = "";
let maxPages = 150; // Increased for hyper-smart search exploration
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
        sortQueue();
        const url = crawlQueue.shift();

        if (visitedUrls.has(url)) continue;
        visitedUrls.add(url);
        currentUrl = url;
        saveState();

        console.log(`[STEM-SCRAPER] Crawling (${visitedUrls.size}/${maxPages}): ${url}`);

        try {
            const delay = Math.floor(Math.random() * (2500 - 800 + 1)) + 800;
            await new Promise(r => setTimeout(r, delay));

            if (!isCrawling) break;

            if (workerTabId === null) {
                workerTabId = await createWorkerTab(url);
            } else {
                try {
                    await updateWorkerTab(workerTabId, url);
                } catch (e) {
                    workerTabId = await createWorkerTab(url);
                }
            }

            // Longer wait for initial search results
            const waitTime = (url.includes('keyword') || url.includes('search')) ? 4000 : 2500;
            await new Promise(r => setTimeout(r, waitTime));

            let result = await new Promise((resolve) => {
                chrome.tabs.sendMessage(workerTabId, { action: "SCAN_PAGE", domain: currentDomain }, (res) => {
                    if (chrome.runtime.lastError) resolve(null);
                    else resolve(res);
                });
            });

            // If it failed or looks like an API/JSON, try direct fetch
            if (!result || url.includes('api') || url.includes('json') || url.includes('.json')) {
                const apiResult = await attemptApiFetch(url);
                if (apiResult) {
                    if (!result) result = apiResult;
                    else result.teachers = [...(result.teachers || []), ...(apiResult.teachers || [])];
                }
            }

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

async function attemptApiFetch(url) {
    try {
        const response = await fetch(url);
        if (response.ok) {
            const text = await response.text();
            const emails = text.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi) || [];
            if (emails.length > 0) {
                const teachers = [...new Set(emails.map(e => e.toLowerCase()))].map(email => ({
                    Name: "Discovered via API/Resource",
                    Email: email,
                    Role: "Unknown (API Source)",
                    PriorityScore: 25,
                    RoleType: "Staff",
                    IsSTEM: "No",
                    ContextSnippet: `Found in resource: ${url}`
                }));
                return { teachers, links: [] };
            }
        }
    } catch (e) {
        console.error("[STEM-SCRAPER] API Fetch failed:", e);
    }
    return null;
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

const HIGH_PRIORITY = ['directory', 'staff', 'faculty', 'teacher', 'people', 'department', 'administration', 'leadership', 'principal', 'superintendent', 'const_search_keyword', 'keyword=math', 'keyword=science'];
const MEDIUM_PRIORITY = ['math', 'science', 'stem', 'technology', 'engineering', 'about', 'contact', 'academics', 'board', 'district'];

function sortQueue() {
    crawlQueue.sort((a, b) => {
        const aLower = a.toLowerCase();
        const bLower = b.toLowerCase();
        
        const getScore = (url) => {
            let score = 0;
            if (HIGH_PRIORITY.some(kw => url.includes(kw))) score += 50;
            if (MEDIUM_PRIORITY.some(kw => url.includes(kw))) score += 20;
            if (url.includes('api') || url.includes('json')) score += 30;
            if (url.includes('keyword=') || url.includes('search=')) score += 40;
            return score;
        };

        return getScore(bLower) - getScore(aLower);
    });
}

async function processScanResults(result, pageUrl) {
    const { teachers, links, discoveredAPIs } = result;

    const allNewLinks = [...(links || []), ...(discoveredAPIs || [])];
    allNewLinks.forEach((link) => {
        try {
            const urlObj = new URL(link);
            urlObj.hash = "";
            const cleanUrl = urlObj.href;

            if (
                urlObj.hostname === currentDomain &&
                !visitedUrls.has(cleanUrl) &&
                !crawlQueue.includes(cleanUrl)
            ) {
                const lower = cleanUrl.toLowerCase();
                if (lower.match(/\.(pdf|jpg|png|doc|docx|xls|xlsx|zip|mp4|mov|jpeg|gif)$/i)) return;
                
                // Be more permissive for search/filter URLs
                const isSearchOrFilter = lower.includes('keyword') || lower.includes('search') || lower.includes('dept') || lower.includes('filter');
                
                if (isSearchOrFilter || HIGH_PRIORITY.concat(MEDIUM_PRIORITY).some(kw => lower.includes(kw)) || visitedUrls.size < 40) {
                    crawlQueue.push(cleanUrl);
                }
            }
        } catch (e) {}
    });

    if (teachers && teachers.length > 0) {
        chrome.storage.local.get(["teachers"], (res) => {
            const existing = res.teachers || [];
            const existingEmails = new Map(existing.map((t) => [t.Email.toLowerCase(), t]));
            let updated = false;

            teachers.forEach((t) => {
                const email = t.Email.toLowerCase();
                if (!existingEmails.has(email)) {
                    t.PageURL = pageUrl;
                    t.CrawledAt = new Date().toISOString();
                    existing.push(t);
                    existingEmails.set(email, t);
                    updated = true;
                } else {
                    const current = existingEmails.get(email);
                    if ((t.PriorityScore || 0) > (current.PriorityScore || 0)) {
                        Object.assign(current, t);
                        updated = true;
                    }
                }
            });

            if (updated) chrome.storage.local.set({ teachers: existing });
        });
    }
}
