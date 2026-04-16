// [STEM-SCRAPER] Background Service Worker
let crawlQueue = [];
let visitedUrls = new Set();
let isCrawling = false;
let currentDomain = "";
let maxPages = 120;
let tabId = null;

// Initialize state from storage on startup
chrome.storage.local.get(
	["crawlQueue", "visitedUrls", "isCrawling", "currentDomain"],
	(res) => {
		if (res.crawlQueue) crawlQueue = res.crawlQueue;
		if (res.visitedUrls) visitedUrls = new Set(res.visitedUrls);
		if (res.isCrawling) isCrawling = res.isCrawling;
		if (res.currentDomain) currentDomain = res.currentDomain;
	},
);

// Helper to save current state
const saveState = () => {
	chrome.storage.local.set({
		crawlQueue,
		visitedUrls: Array.from(visitedUrls),
		isCrawling,
		currentDomain,
	});
};

// Listen for messages from Popup
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
		chrome.storage.local.set({
			teachers: [],
			crawlQueue: [],
			visitedUrls: [],
			isCrawling: false,
			currentDomain: "",
		});
		sendResponse({ status: "cleared" });
	} else if (message.action === "GET_STATUS") {
		sendResponse({
			isCrawling,
			queueLength: crawlQueue.length,
			visitedCount: visitedUrls.size,
			currentDomain,
		});
	}
});

async function startCrawlerLoop() {
	while (isCrawling && crawlQueue.length > 0 && visitedUrls.size < maxPages) {
		const url = crawlQueue.shift();

		if (visitedUrls.has(url)) continue;
		visitedUrls.add(url);
		saveState();

		console.log(`[STEM-SCRAPER] Queuing: ${url}`);

		try {
			// Polite delay (800ms - 2500ms)
			const delay = Math.floor(Math.random() * (2500 - 800 + 1)) + 800;
			await new Promise((resolve) => setTimeout(resolve, delay));

			if (!isCrawling) break;

			tabId = await createHiddenTab(url);

			// Wait for dynamic content (React/Vue/CMS) to render
			await new Promise((resolve) => setTimeout(resolve, 1500));

			// Request extraction from the content script
			const result = await new Promise((resolve) => {
				chrome.tabs.sendMessage(
					tabId,
					{ action: "SCAN_PAGE", domain: currentDomain },
					(res) => {
						if (chrome.runtime.lastError) {
							resolve(null); // Ignore errors (e.g., non-HTML page, PDF)
						} else {
							resolve(res);
						}
					},
				);
			});

			if (result) {
				await processScanResults(result, url);
			}

			await chrome.tabs.remove(tabId);
			tabId = null;
		} catch (error) {
			console.error(`[STEM-SCRAPER] Error on ${url}:`, error);
			if (tabId) {
				try {
					await chrome.tabs.remove(tabId);
					tabId = null;
				} catch (e) {}
			}
		}
	}

	if (visitedUrls.size >= maxPages || crawlQueue.length === 0) {
		isCrawling = false;
		saveState();
		console.log("[STEM-SCRAPER] Crawl finished or reached limits.");
	}
}

function createHiddenTab(url) {
	return new Promise((resolve) => {
		chrome.tabs.create({ url, active: false }, (tab) => {
			chrome.tabs.onUpdated.addListener(function listener(tId, info) {
				if (tId === tab.id && info.status === "complete") {
					chrome.tabs.onUpdated.removeListener(listener);
					resolve(tab.id);
				}
			});
		});
	});
}

async function processScanResults(result, pageUrl) {
	const { teachers, links } = result;

	// Filter and enqueue new promising links
	const promisingKeywords = [
		"staff",
		"faculty",
		"directory",
		"teacher",
		"math",
		"science",
		"stem",
		"department",
		"about",
		"contact",
		"people",
	];

	links.forEach((link) => {
		try {
			const linkObj = new URL(link);
			if (
				linkObj.hostname === currentDomain &&
				!visitedUrls.has(linkObj.href) &&
				!crawlQueue.includes(linkObj.href)
			) {
				const lowerLink = linkObj.href.toLowerCase();
				// Avoid files
				if (lowerLink.match(/\.(pdf|jpg|png|doc|docx|xls|xlsx|zip)$/i)) return;

				if (promisingKeywords.some((kw) => lowerLink.includes(kw))) {
					crawlQueue.push(linkObj.href);
				}
			}
		} catch (e) {
			/* invalid url */
		}
	});

	// Save extracted teachers (Deduplicate by email)
	if (teachers && teachers.length > 0) {
		chrome.storage.local.get(["teachers"], (res) => {
			const existing = res.teachers || [];
			const existingEmails = new Set(
				existing.map((t) => t.Email.toLowerCase()),
			);
			let addedCount = 0;

			teachers.forEach((t) => {
				if (!existingEmails.has(t.Email.toLowerCase())) {
					t.PageURL = pageUrl;
					t.CrawledAt = new Date().toISOString();
					existing.push(t);
					existingEmails.add(t.Email.toLowerCase());
					addedCount++;
				}
			});

			if (addedCount > 0) {
				chrome.storage.local.set({ teachers: existing });
			}
		});
	}
}
