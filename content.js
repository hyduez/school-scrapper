// [STEM-SCRAPER] Content Script - Improved Extraction Engine

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "SCAN_PAGE") {
        const results = performExtraction(request.domain);
        sendResponse(results);
    }
    return true;
});

// --- Constants & Config ---
const STEM_WEIGHTS = {
    keywords: {
        'math': 10, 'mathematics': 10, 'algebra': 10, 'calculus': 10, 'geometry': 10, 'statistics': 10, 'trigonometry': 10,
        'science': 10, 'biology': 10, 'physics': 10, 'chemistry': 10, 'earth science': 10, 'life science': 10, 'anatomy': 10,
        'technology': 10, 'computer science': 10, 'coding': 10, 'robotics': 10, 'it': 5, 'ict': 10,
        'engineering': 10, 'stem': 15, 'steam': 10, 'maker': 5
    },
    negative: ['english', 'history', 'arts', 'fine arts', 'music', 'physical education', 'pe', 'social studies', 'spanish', 'french', 'language', 'humanities', 'arts', 'theatre', 'drama', 'social science', 'social studies']
};

const ROLE_KEYWORDS = /teacher|instructor|professor|head|director|coordinator|advisor|faculty|coach|specialist|principal|assistant/i;
const NAME_BLACKLIST = ['contact', 'email', 'phone', 'staff', 'teacher', 'faculty', 'directory', 'back to top', 'name', 'profile', 'department', 'view', 'more'];
const EMAIL_REGEX = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;

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
    // Check for data-user and data-domain combo
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

    // Tag Type Bonuses
    if (['TR', 'LI', 'ARTICLE', 'SECTION'].includes(tagName)) score += 5;
    if (tagName === 'DIV') score += 2;

    // Class/ID Matches
    const keywords = ['staff', 'member', 'profile', 'card', 'directory', 'teacher', 'user', 'person', 'row', 'item'];
    keywords.forEach(kw => {
        if (className.includes(kw)) score += 3;
        if (id.includes(kw)) score += 3;
    });

    // Structure
    if (element.querySelector('h1, h2, h3, h4, h5, h6, strong, b')) score += 5;
    
    const mailtos = element.querySelectorAll('a[href^="mailto:"]');
    if (mailtos.length === 1) score += 5;
    else if (mailtos.length > 1) score -= 5; // Probably a list container, not a single teacher card

    // Sibling analysis - repeating elements suggest list items
    if (element.parentElement) {
        const siblings = Array.from(element.parentElement.children);
        if (siblings.length > 1) {
            const sameTag = siblings.filter(s => s.tagName === tagName).length;
            const sameClass = siblings.filter(s => s.className === element.className && element.className !== "").length;
            if (sameTag > 2) score += 2;
            if (sameClass > 2) score += 5;
        }
    }

    // Size penalty/bonus
    const textLen = (element.innerText || "").trim().length;
    if (textLen > 2000) score -= 20; // Too big
    if (textLen < 30) score -= 10; // Too small
    if (textLen > 100 && textLen < 800) score += 5; // Good size for a card

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
        .replace(/^(Name|Email|Contact|Teacher|Staff|Instructor|Mr\.|Mrs\.|Ms\.|Dr\.|Coach):\s*/i, "")
        .replace(/,\s*(PhD|M\.?S\.?|B\.?S\.?|Ed\.?D\.?|MA|BA|BS|National Board Certified).*$/i, "")
        .replace(/\s+/g, " ")
        .trim();
}

function extractName(container, emailNode) {
    // Pass 1: Microdata
    const microdataName = container.querySelector('[itemprop="name"]');
    if (microdataName && microdataName.innerText.trim()) {
        const n = cleanName(microdataName.innerText);
        if (n.length > 2 && n.length < 50) return n;
    }

    // Pass 2: Headings within the container
    const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6, strong, b');
    for (const h of headings) {
        const text = h.innerText.trim();
        if (text.length > 2 && text.length < 50 && !NAME_BLACKLIST.some(b => text.toLowerCase().includes(b))) {
            if (!text.includes('@')) return cleanName(text);
        }
    }

    // Pass 3: Table Analysis
    if (container.tagName === 'TR' || container.querySelector('td')) {
        const cells = container.querySelectorAll('td');
        if (cells.length > 0) {
            for (let i = 0; i < Math.min(cells.length, 3); i++) {
                const text = cells[i].innerText.trim();
                if (text.length > 2 && text.length < 50 && !text.includes('@') && !NAME_BLACKLIST.some(b => text.toLowerCase().includes(b))) {
                    return cleanName(text);
                }
            }
        }
    }

    // Pass 4: Proximity to email node in text
    const textContent = container.innerText;
    const lines = textContent.split('\n').map(l => l.trim()).filter(l => l.length > 2 && l.length < 60);
    const emailLineIdx = lines.findIndex(l => l.toLowerCase().includes(emailNode.innerText.trim().toLowerCase() || "@"));
    
    if (emailLineIdx > 0) {
        for (let i = emailLineIdx - 1; i >= 0; i--) {
            const line = lines[i];
            if (!line.includes('@') && !NAME_BLACKLIST.some(b => line.toLowerCase().includes(b))) {
                return cleanName(line);
            }
        }
    }

    // Pass 5: Fallback - First reasonable line
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
        // Try to find the full line containing this match
        const lineMatch = lines.find(l => l.includes(match[0]));
        if (lineMatch && lineMatch.length < 80) return lineMatch;
        return match[0];
    }
    
    return "Staff/Teacher";
}

function getStemScore(container, role) {
    let score = 0;
    const text = (container.innerText + " " + (role || "")).toLowerCase();
    
    for (const [kw, weight] of Object.entries(STEM_WEIGHTS.keywords)) {
        if (text.includes(kw)) score += weight;
    }
    
    STEM_WEIGHTS.negative.forEach(kw => {
        if (text.includes(kw)) score -= 20;
    });
    
    const url = window.location.href.toLowerCase();
    for (const [kw, weight] of Object.entries(STEM_WEIGHTS.keywords)) {
        if (url.includes(kw)) {
            score += 5;
            break; 
        }
    }

    // Also check if any H1/H2 on the page says something about STEM
    const pageTitle = (document.querySelector('h1, h2')?.innerText || "").toLowerCase();
    for (const [kw, weight] of Object.entries(STEM_WEIGHTS.keywords)) {
        if (pageTitle.includes(kw)) {
            score += 5;
            break; 
        }
    }
    
    return score;
}

// --- Main Extraction Engine ---

function performExtraction(targetDomain) {
    const foundEmails = new Map();

    // Calculate distinctive parts of the domain to filter out third-party emails
    const domainParts = targetDomain.toLowerCase().replace("www.", "").split(".");
    const distinctiveParts = domainParts.filter(p => p.length > 2 && !['com', 'org', 'net', 'edu', 'gov', 'k12', 'us'].includes(p));
    
    const isTargetDomain = (email) => {
        const parts = email.toLowerCase().split('@');
        if (parts.length < 2) return false;
        const emailDomain = parts[1];
        // If we couldn't find distinctive parts, allow all emails (fallback)
        if (distinctiveParts.length === 0) return true;
        return distinctiveParts.some(p => emailDomain.includes(p));
    };

    const processTeacher = (email, node) => {
        if (!email || !isTargetDomain(email) || foundEmails.has(email)) return;

        const container = findBestContainer(node);
        const name = extractName(container, node);
        const role = extractRole(container, name);
        const stemScore = getStemScore(container, role);
        
        foundEmails.set(email, {
            Name: name,
            Email: email,
            Role: role,
            IsSTEM: stemScore >= 10 ? "Yes" : "No",
            ContextSnippet: (container.innerText || "").substring(0, 150).replace(/\s+/g, " ").trim() + "..."
        });
    };

    // 1. Scan mailto links and elements with email attributes
    const allElements = document.querySelectorAll('a, div, span, td, li');
    allElements.forEach(el => {
        const email = getEmailFromAttributes(el);
        if (email) processTeacher(email, el);
    });

    // 2. Scan text nodes for raw emails (including de-obfuscation)
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while ((node = walker.nextNode())) {
        const text = deObfuscate(node.nodeValue);
        const matches = text.match(EMAIL_REGEX);
        if (matches) {
            matches.forEach(email => processTeacher(email.toLowerCase(), node.parentElement));
        }
    }

    // 3. Extract School Address (standard regex)
    let schoolAddress = "";
    const addressMatch = document.body.innerText.match(
        /\b\d{1,5}\s+[A-Za-z\s.,]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr).*?\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/is,
    );
    if (addressMatch) {
        schoolAddress = addressMatch[0].replace(/\n/g, ", ").trim();
    }

    // 4. Collect links for crawling
    const links = Array.from(document.querySelectorAll("a[href]")).map(a => a.href);

    const results = Array.from(foundEmails.values()).map(t => {
        t.SchoolAddress = schoolAddress;
        return t;
    });

    console.log(`[STEM-SCRAPER] Page: ${window.location.href} | Teachers: ${results.length} | STEM: ${results.filter(r => r.IsSTEM === "Yes").length}`);

    return { teachers: results, links: links };
}
