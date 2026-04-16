// [STEM-SCRAPER] Content Script - Hyper-Smart Extraction Engine

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "SCAN_PAGE") {
        const results = performExtraction(request.domain);
        sendResponse(results);
    }
    return true;
});

// --- Constants & Config ---
const STEM_KEYWORDS = {
    'math': 10, 'mathematics': 10, 'algebra': 10, 'calculus': 10, 'geometry': 10, 'statistics': 10, 'trigonometry': 10,
    'science': 10, 'biology': 10, 'physics': 10, 'chemistry': 10, 'earth science': 10, 'life science': 10, 'anatomy': 10,
    'technology': 10, 'computer science': 10, 'coding': 10, 'robotics': 10, 'it': 5, 'ict': 10,
    'engineering': 10, 'stem': 15, 'steam': 10, 'maker': 5, 'biotech': 10, 'physic': 10, 'chem': 10, 'bio': 5
};

const NEGATIVE_KEYWORDS = ['english', 'history', 'arts', 'fine arts', 'music', 'physical education', 'pe', 'social studies', 'spanish', 'french', 'language', 'humanities', 'theatre', 'drama', 'social science', 'counselor', 'nurse', 'custodian', 'food service'];

const LEADERSHIP_KEYWORDS = /principal|superintendent|director|head|administrator|dean|coordinator|chief|president|manager|supervisor|chancellor/i;
const ROLE_KEYWORDS = /teacher|instructor|professor|head|director|coordinator|advisor|faculty|coach|specialist|principal|assistant|librarian|specialist/i;
const NAME_BLACKLIST = ['contact', 'email', 'phone', 'staff', 'teacher', 'faculty', 'directory', 'back to top', 'name', 'profile', 'department', 'view', 'more', 'search', 'home', 'login'];
const EMAIL_REGEX = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;

// Search/Filter Selectors
const SEARCH_INPUT_SELECTORS = [
    'input[name*="search"]',
    'input[id*="search"]',
    'input[name*="keyword"]',
    'input[id*="keyword"]',
    'input[placeholder*="Search"]',
    'input[placeholder*="keyword"]',
    '#const_search_keyword' // Finalsite specific
];

const FILTER_SELECTORS = [
    'select[name*="dept"]',
    'select[id*="dept"]',
    'select[name*="filter"]',
    'select[id*="filter"]',
    'select[name*="category"]',
    '.department-filter select'
];

// --- Helper Utilities ---

function deObfuscate(text) {
    if (!text) return "";
    return text
        .replace(/\s*[\[\(]at[\]\)]\s*/gi, "@")
        .replace(/\s*[\[\(]dot[\]\)]\s*/gi, ".")
        .replace(/mailto:/i, "")
        .replace(/\s*@\s*/g, "@")
        .replace(/\s*\.\s*/g, ".")
        .trim();
}

function getEmailFromAttributes(element) {
    const attrs = ['href', 'data-email', 'data-user', 'data-domain', 'title', 'aria-label'];
    for (const attr of attrs) {
        let val = element.getAttribute(attr);
        if (val) {
            if (attr === 'href' && val.startsWith('mailto:')) val = val.substring(7).split('?')[0];
            const deob = deObfuscate(val);
            const match = deob.match(EMAIL_REGEX);
            if (match) return match[0].toLowerCase();
        }
    }
    const user = element.getAttribute('data-user');
    const domain = element.getAttribute('data-domain');
    if (user && domain) {
        return deObfuscate(`${user}@${domain}`).toLowerCase();
    }
    return null;
}

function getContainerScore(element) {
    if (!element || element.tagName === 'BODY' || element.tagName === 'HTML') return -100;
    
    let score = 0;
    const tagName = element.tagName.toUpperCase();
    const className = (element.className || "").toString().toLowerCase();
    const id = (element.id || "").toLowerCase();
    const text = (element.innerText || "").toLowerCase();

    // Tag Type Bonuses
    if (['TR', 'LI', 'ARTICLE', 'SECTION'].includes(tagName)) score += 10;
    if (tagName === 'DIV') score += 5;

    // Class/ID Matches
    const keywords = ['staff', 'member', 'profile', 'card', 'directory', 'teacher', 'user', 'person', 'row', 'item', 'faculty'];
    keywords.forEach(kw => {
        if (className.includes(kw)) score += 5;
        if (id.includes(kw)) score += 5;
    });

    // Content Indicators
    if (element.querySelector('h1, h2, h3, h4, h5, h6, strong, b')) score += 10;
    if (text.includes('email') || text.includes('@')) score += 10;
    if (text.includes('phone') || text.match(/\d{3}-\d{3}-\d{4}/)) score += 5;
    
    // STEM/Leadership density
    for (const [kw, weight] of Object.entries(STEM_KEYWORDS)) {
        if (text.includes(kw)) score += 5;
    }
    if (LEADERSHIP_KEYWORDS.test(text)) score += 10;

    const mailtos = element.querySelectorAll('a[href^="mailto:"]');
    if (mailtos.length === 1) score += 20;
    else if (mailtos.length > 1) score -= 10; 

    // Structure consistency
    if (element.parentElement) {
        const siblings = Array.from(element.parentElement.children);
        if (siblings.length > 1) {
            const sameTag = siblings.filter(s => s.tagName === tagName).length;
            const sameClass = siblings.filter(s => s.className === element.className && element.className !== "").length;
            if (sameTag > 2) score += 5;
            if (sameClass > 2) score += 10;
        }
    }

    const textLen = text.trim().length;
    if (textLen > 2500) score -= 30;
    if (textLen < 50) score -= 15;
    if (textLen > 150 && textLen < 1000) score += 15;

    return score;
}

function findBestContainer(startNode) {
    let current = startNode;
    let best = startNode;
    let maxScore = -100;
    let depth = 0;

    while (current && depth < 10 && current.tagName !== 'BODY') {
        const score = getContainerScore(current);
        if (score > maxScore) {
            maxScore = score;
            best = current;
        }
        current = current.parentElement;
        depth++;
    }
    return best;
}

function cleanName(name) {
    if (!name) return "";
    return name
        .replace(/^(Name|Email|Contact|Teacher|Staff|Instructor|Mr\.|Mrs\.|Ms\.|Dr\.|Coach|Name:):\s*/i, "")
        .replace(/,\s*(PhD|M\.?S\.?|B\.?S\.?|Ed\.?D\.?|MA|BA|BS|National Board Certified).*$/i, "")
        .replace(/\s+/g, " ")
        .trim();
}

function extractName(container, emailNode) {
    const microdataName = container.querySelector('[itemprop="name"]');
    if (microdataName && microdataName.innerText.trim()) {
        const n = cleanName(microdataName.innerText);
        if (n.length > 2 && n.length < 50) return n;
    }

    const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6, strong, b, .name, [class*="name"]');
    for (const h of headings) {
        const text = h.innerText.trim();
        if (text.length > 2 && text.length < 50 && !NAME_BLACKLIST.some(b => text.toLowerCase() === b) && !text.includes('@')) {
            return cleanName(text);
        }
    }

    if (container.tagName === 'TR' || container.querySelector('td')) {
        const cells = container.querySelectorAll('td');
        for (let i = 0; i < Math.min(cells.length, 3); i++) {
            const text = cells[i].innerText.trim();
            if (text.length > 2 && text.length < 50 && !text.includes('@') && !NAME_BLACKLIST.some(b => text.toLowerCase().includes(b))) {
                return cleanName(text);
            }
        }
    }

    const textContent = container.innerText;
    const lines = textContent.split('\n').map(l => l.trim()).filter(l => l.length > 2 && l.length < 60);
    const emailText = emailNode.innerText.trim().toLowerCase();
    const emailLineIdx = lines.findIndex(l => (emailText && l.toLowerCase().includes(emailText)) || l.toLowerCase().includes("@"));
    
    if (emailLineIdx > 0) {
        for (let i = emailLineIdx - 1; i >= 0; i--) {
            const line = lines[i];
            if (!line.includes('@') && !NAME_BLACKLIST.some(b => line.toLowerCase().includes(b))) {
                return cleanName(line);
            }
        }
    }

    for (const line of lines) {
        if (!line.includes('@') && !NAME_BLACKLIST.some(b => line.toLowerCase().includes(b))) {
            return cleanName(line);
        }
    }

    return "Unknown";
}

function extractRole(container, name) {
    const text = container.innerText;
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    for (const line of lines) {
        if (ROLE_KEYWORDS.test(line) && !line.includes('@') && line !== name && !name.includes(line)) {
            if (line.length < 80) return line;
        }
    }
    
    const match = text.match(ROLE_KEYWORDS);
    if (match) {
        const lineMatch = lines.find(l => l.includes(match[0]));
        if (lineMatch && lineMatch.length < 80) return lineMatch;
        return match[0];
    }
    
    return "Staff/Teacher";
}

function calculatePriorityScore(container, role) {
    let score = 0;
    const text = (container.innerText + " " + (role || "")).toLowerCase();
    
    let stemScore = 0;
    for (const [kw, weight] of Object.entries(STEM_KEYWORDS)) {
        if (text.includes(kw)) stemScore += weight;
    }
    NEGATIVE_KEYWORDS.forEach(kw => {
        if (text.includes(kw)) stemScore -= 20;
    });

    let leadershipScore = 0;
    if (LEADERSHIP_KEYWORDS.test(role || "")) leadershipScore += 40;
    if (LEADERSHIP_KEYWORDS.test(container.innerText)) leadershipScore += 10;

    score = Math.max(stemScore, leadershipScore);

    const url = window.location.href.toLowerCase();
    if (url.includes('admin') || url.includes('leader') || url.includes('principal')) score += 15;
    if (url.includes('stem') || url.includes('math') || url.includes('science') || url.includes('tech')) score += 15;

    return {
        total: score,
        isSTEM: stemScore >= 10,
        isLeadership: leadershipScore >= 30
    };
}

function detectHiddenAPIs() {
    try {
        const entries = window.performance.getEntriesByType('resource');
        return entries
            .filter(entry => 
                entry.initiatorType === 'fetch' || 
                entry.initiatorType === 'xmlhttprequest'
            )
            .filter(entry => 
                entry.name.includes('api') || 
                entry.name.includes('json') || 
                entry.name.includes('staff') || 
                entry.name.includes('directory') ||
                entry.name.includes('search') ||
                entry.name.includes('const_search')
            )
            .map(entry => entry.name);
    } catch (e) {
        return [];
    }
}

function findSearchAndFilters() {
    const discoveredActions = [];
    const baseUrl = window.location.origin + window.location.pathname;

    // Detect Search Inputs
    SEARCH_INPUT_SELECTORS.forEach(selector => {
        const input = document.querySelector(selector);
        if (input) {
            const form = input.closest('form');
            if (form && form.method.toLowerCase() === 'get') {
                const action = form.action || baseUrl;
                const name = input.name || 'keyword';
                ['Math', 'Science', 'STEM', 'Technology'].forEach(term => {
                    const searchUrl = new URL(action, window.location.href);
                    searchUrl.searchParams.set(name, term);
                    discoveredActions.push(searchUrl.href);
                });
            } else if (input.id === 'const_search_keyword') {
                // Finalsite specific logic - usually triggers a JS search
                ['Math', 'Science', 'STEM'].forEach(term => {
                    discoveredActions.push(`${baseUrl}?const_search_keyword=${term}`);
                });
            }
        }
    });

    // Detect Dropdown Filters
    FILTER_SELECTORS.forEach(selector => {
        const selects = document.querySelectorAll(selector);
        selects.forEach(select => {
            Array.from(select.options).forEach(opt => {
                const val = opt.value;
                const text = opt.innerText.toLowerCase();
                if (val && (text.includes('math') || text.includes('science') || text.includes('stem') || text.includes('tech'))) {
                    const filterUrl = new URL(window.location.href);
                    filterUrl.searchParams.set(select.name || 'department', val);
                    discoveredActions.push(filterUrl.href);
                }
            });
        });
    });

    // Department links
    const deptLinks = document.querySelectorAll('a[href*="dept"], a[href*="filter"], a[href*="category"]');
    deptLinks.forEach(a => {
        const text = a.innerText.toLowerCase();
        if (text.includes('math') || text.includes('science') || text.includes('stem') || text.includes('tech')) {
            discoveredActions.push(a.href);
        }
    });

    return [...new Set(discoveredActions)];
}

// --- Main Extraction Engine ---

function performExtraction(targetDomain) {
    const foundEmails = new Map();

    const domainParts = targetDomain.toLowerCase().replace("www.", "").split(".");
    const distinctiveParts = domainParts.filter(p => p.length > 2 && !['com', 'org', 'net', 'edu', 'gov', 'k12', 'us', 'schools'].includes(p));
    
    const isTargetDomain = (email) => {
        const parts = email.toLowerCase().split('@');
        if (parts.length < 2) return false;
        const emailDomain = parts[1];
        if (distinctiveParts.length === 0) return true;
        return distinctiveParts.some(p => emailDomain.includes(p));
    };

    const processTeacher = (email, node) => {
        if (!email || !isTargetDomain(email) || foundEmails.has(email)) return;

        const container = findBestContainer(node);
        const name = extractName(container, node);
        const role = extractRole(container, name);
        const scoreData = calculatePriorityScore(container, role);
        
        foundEmails.set(email, {
            Name: name,
            Email: email,
            Role: role,
            PriorityScore: scoreData.total,
            RoleType: scoreData.isLeadership ? "Leadership" : (scoreData.isSTEM ? "STEM" : "Staff"),
            IsSTEM: scoreData.isSTEM ? "Yes" : "No",
            ContextSnippet: (container.innerText || "").substring(0, 200).replace(/\s+/g, " ").trim() + "..."
        });
    };

    // 1. Dual Collection: mailto + attributes
    document.querySelectorAll('a, [data-email], [data-user]').forEach(el => {
        const email = getEmailFromAttributes(el);
        if (email) processTeacher(email, el);
    });

    // 2. Dual Collection: Regex scan of text nodes
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while ((node = walker.nextNode())) {
        const text = deObfuscate(node.nodeValue);
        const matches = text.match(EMAIL_REGEX);
        if (matches) {
            matches.forEach(email => processTeacher(email.toLowerCase(), node.parentElement));
        }
    }

    // 3. Extract School Address
    let schoolAddress = "";
    const addressMatch = document.body.innerText.match(
        /\b\d{1,5}\s+[A-Za-z\s.,]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr).*?\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/is,
    );
    if (addressMatch) {
        schoolAddress = addressMatch[0].replace(/\n/g, ", ").trim();
    }

    // 4. Collect links and discovery actions
    const links = Array.from(document.querySelectorAll("a[href]")).map(a => a.href);
    const discoveredActions = findSearchAndFilters();
    
    const discoveredAPIs = detectHiddenAPIs();

    const results = Array.from(foundEmails.values()).map(t => {
        t.SchoolAddress = schoolAddress;
        return t;
    });

    console.log(`[STEM-SCRAPER] Page: ${window.location.href} | Teachers: ${results.length} | Actions: ${discoveredActions.length} | APIs: ${discoveredAPIs.length}`);

    return { 
        teachers: results, 
        links: [...new Set([...links, ...discoveredActions])],
        discoveredAPIs: discoveredAPIs
    };
}
