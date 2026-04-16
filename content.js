// [STEM-SCRAPER] Content Script
// Implements highly robust DOM traversal and data extraction.

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	if (request.action === "SCAN_PAGE") {
		const results = performExtraction(request.domain);
		sendResponse(results);
	}
	return true;
});

function performExtraction(targetDomain) {
	const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;
	const stemKeywords =
		/math|science|biology|physics|chemistry|stem|engineering|algebra|calculus|geometry|robotics|computer\s+science|mathematics|technology|information/i;
	const roleKeywords =
		/teacher|instructor|professor|head|director|coordinator|advisor|faculty|coach/i;

	// Pattern for matching names like "Mr. John Doe", "Jane Smith, PhD", or just standard capitalized names.
	const titlePrefixes = /^(Mr\.|Mrs\.|Ms\.|Dr\.|Coach)\s+/i;
	const strictNamePattern =
		/^([A-Z][a-z.'-]+\s+){1,3}[A-Z][a-z.'-]+(,\s*(PhD|M\.?S\.?|B\.?S\.?|Ed\.?D\.?))?$/;

	const foundEmails = new Map();

	// Calculate the base domain (e.g., "school.edu" from "www.school.edu")
	const domainParts = targetDomain.replace("www.", "").split(".");
	const rootDomain =
		domainParts.length > 1
			? domainParts[domainParts.length - 2]
			: domainParts[0];

	const isTargetDomain = (email) => email.toLowerCase().includes(rootDomain);

	// ==========================================
	// 1. Dual Collection: mailto: links
	// ==========================================
	const mailtoLinks = document.querySelectorAll('a[href^="mailto:"]');
	mailtoLinks.forEach((a) => {
		let email = a.href
			.replace("mailto:", "")
			.split("?")[0]
			.trim()
			.toLowerCase();
		if (isTargetDomain(email) && !foundEmails.has(email)) {
			processEmailNode(a, email);
		}
	});

	// ==========================================
	// 2. Dual Collection: Fallback raw text scan
	// ==========================================
	const walker = document.createTreeWalker(
		document.body,
		NodeFilter.SHOW_TEXT,
		null,
		false,
	);
	let node;
	while ((node = walker.nextNode())) {
		const matches = node.nodeValue.match(emailRegex);
		if (matches) {
			matches.forEach((emailStr) => {
				const email = emailStr.toLowerCase();
				if (isTargetDomain(email) && !foundEmails.has(email)) {
					processEmailNode(node.parentElement, email);
				}
			});
		}
	}

	// ==========================================
	// Core Logic: Smart Container Traversal
	// ==========================================
	function processEmailNode(startNode, emailStr) {
		if (!startNode) return;

		let container = startNode;
		let depth = 0;
		let meaningfulContainer = null;

		// Walk up DOM (max 8 levels) to find a logical "card" or "row"
		while (container && depth < 8 && container.tagName !== "BODY") {
			const textLen = (container.innerText || "").trim().length;
			const hasHeading = container.querySelector(
				"h1, h2, h3, h4, h5, h6, strong, b",
			);

			// A meaningful container usually has headings or a solid chunk of text (not the whole page)
			if ((textLen > 100 && textLen < 2000) || hasHeading) {
				meaningfulContainer = container;
				break;
			}
			container = container.parentElement;
			depth++;
		}

		// Fallback: Find closest block-level element
		if (!meaningfulContainer) {
			container = startNode;
			depth = 0;
			while (container && depth < 8 && container.tagName !== "BODY") {
				if (
					["DIV", "SECTION", "ARTICLE", "TR", "LI", "TD"].includes(
						container.tagName,
					)
				) {
					meaningfulContainer = container;
					break;
				}
				container = container.parentElement;
				depth++;
			}
		}

		// Ultimate fallback
		if (!meaningfulContainer)
			meaningfulContainer = startNode.parentElement || document.body;

		const contextText = meaningfulContainer.innerText || "";

		// --- Extract Name ---
		let name = "Unknown";

		// Strategy A: Look for explicit headings
		const heading = meaningfulContainer.querySelector(
			"h1, h2, h3, h4, h5, h6, strong, b",
		);
		if (
			heading &&
			heading.innerText.trim().length > 2 &&
			heading.innerText.trim().length < 40
		) {
			name = heading.innerText.trim();
		} else {
			// Strategy B: Analyze lines for name patterns
			const lines = contextText
				.split("\n")
				.map((l) => l.trim())
				.filter((l) => l.length > 0);
			for (let line of lines) {
				if (line.includes("@")) continue; // Skip email lines
				if (titlePrefixes.test(line) || strictNamePattern.test(line)) {
					name = line;
					break;
				}
			}
			// Strategy C: Fallback to the first short line that isn't the email
			if (name === "Unknown" && lines.length > 0) {
				const firstValid = lines.find(
					(l) => l.length > 2 && l.length < 40 && !l.includes("@"),
				);
				if (firstValid) name = firstValid;
			}
		}

		// Clean up common prefixes from poorly formatted sites
		name = name
			.replace(/^(Name|Email|Contact|Teacher):\s*/i, "")
			.replace(/\s+/g, " ")
			.trim();

		// --- Extract Role ---
		let role = "Staff/Teacher";
		const roleMatch = contextText.match(roleKeywords);
		if (roleMatch) {
			role = roleMatch[0];
			const lines = contextText.split("\n").map((l) => l.trim());
			const rLine = lines.find((l) =>
				l.toLowerCase().includes(role.toLowerCase()),
			);
			if (rLine && rLine.length < 60) role = rLine; // Capture the full title, e.g., "Math Department Head"
		}

		// --- STEM / Department Detection ---
		let isStem = "No";
		const pageUrl = window.location.href.toLowerCase();

		// Boost if the URL indicates a STEM department
		const urlStemMatch = stemKeywords.test(pageUrl);
		// Check the local context card for STEM keywords
		const contentStemMatch = stemKeywords.test(contextText);

		// Check closest main heading on the page to see if we are in a STEM section
		let inStemSection = false;
		const pageHeadings = document.querySelectorAll("h1, h2");
		pageHeadings.forEach((h) => {
			if (stemKeywords.test(h.innerText)) inStemSection = true;
		});

		if (urlStemMatch || contentStemMatch || inStemSection) {
			isStem = "Yes";
		}

		// Save data
		foundEmails.set(emailStr, {
			Name: name,
			Email: emailStr,
			Role: role,
			IsSTEM: isStem,
			ContextSnippet:
				contextText.substring(0, 150).replace(/\s+/g, " ").trim() + "...",
		});
	}

	// ==========================================
	// 3. Extract School Address
	// ==========================================
	let schoolAddress = "";
	const addressMatch = document.body.innerText.match(
		/\b\d{1,5}\s+[A-Za-z\s.,]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr).*?\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/is,
	);
	if (addressMatch) {
		schoolAddress = addressMatch[0].replace(/\n/g, ", ").trim();
	}

	// ==========================================
	// 4. Extract Internal Links
	// ==========================================
	const links = Array.from(document.querySelectorAll("a[href]")).map(
		(a) => a.href,
	);

	// Finalize Results
	const results = Array.from(foundEmails.values()).map((t) => {
		t.SchoolAddress = schoolAddress;
		return t;
	});

	// Debugging Console Output requested by prompt
	const stemCount = results.filter((r) => r.IsSTEM === "Yes").length;
	console.log(
		`[STEM-SCRAPER] Page: ${window.location.href} | Emails found: ${results.length} | STEM teachers: ${stemCount}`,
	);

	return { teachers: results, links: links };
}
