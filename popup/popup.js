document.addEventListener("DOMContentLoaded", () => {
    const btnStart = document.getElementById("btn-start");
    const btnPause = document.getElementById("btn-pause");
    const btnResume = document.getElementById("btn-resume");
    const btnClear = document.getElementById("btn-clear");
    const btnExport = document.getElementById("btn-export");

    const statusBadge = document.getElementById("status-badge");
    const currentDomainEl = document.getElementById("current-domain");
    const pagesCrawledEl = document.getElementById("pages-crawled");
    const currentUrlEl = document.getElementById("current-url");
    const teachersFoundEl = document.getElementById("teachers-found");
    const stemFoundEl = document.getElementById("stem-found");
    const resultsBody = document.getElementById("results-body");

    let targetUrl = "";

    // Grab current tab info
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            targetUrl = tabs[0].url;
            try {
                currentDomainEl.textContent = new URL(targetUrl).hostname;
            } catch (e) {
                currentDomainEl.textContent = "Invalid URL";
            }
        }
    });

    function updateUI() {
        chrome.storage.local.get(
            ["isCrawling", "visitedUrls", "teachers", "currentDomain", "currentUrl"],
            (res) => {
                const isCrawling = res.isCrawling || false;
                const visitedCount = res.visitedUrls ? res.visitedUrls.length : 0;
                const teachers = res.teachers || [];
                const domain = res.currentDomain || currentDomainEl.textContent;
                const url = res.currentUrl || "Idle";

                currentDomainEl.textContent = domain;
                pagesCrawledEl.textContent = visitedCount;
                currentUrlEl.textContent = url;
                teachersFoundEl.textContent = teachers.length;

                const stemCount = teachers.filter((t) => t.IsSTEM === "Yes").length;
                stemFoundEl.textContent = stemCount;

                if (isCrawling) {
                    statusBadge.textContent = "Running";
                    statusBadge.className = "badge running";
                    btnStart.disabled = true;
                    btnPause.disabled = false;
                    btnResume.disabled = true;
                } else if (visitedCount > 0) {
                    statusBadge.textContent = "Paused / Stopped";
                    statusBadge.className = "badge paused";
                    btnStart.disabled = false;
                    btnPause.disabled = true;
                    btnResume.disabled = false;
                } else {
                    statusBadge.textContent = "Idle";
                    statusBadge.className = "badge idle";
                    btnStart.disabled = false;
                    btnPause.disabled = true;
                    btnResume.disabled = true;
                }

                renderTable(teachers);
            },
        );
    }

    function renderTable(teachers) {
        resultsBody.innerHTML = "";

        // Sort: STEM teachers first
        const sortedTeachers = [...teachers].sort((a, b) => {
            if (a.IsSTEM === "Yes" && b.IsSTEM === "No") return -1;
            if (a.IsSTEM === "No" && b.IsSTEM === "Yes") return 1;
            return 0;
        });

        sortedTeachers.forEach((t) => {
            const tr = document.createElement("tr");
            const stemClass = t.IsSTEM === "Yes" ? "is-stem-yes" : "";

            tr.innerHTML = `
                <td title="${t.Name}">${t.Name}</td>
                <td title="${t.Email}"><a href="mailto:${t.Email}">${t.Email}</a></td>
                <td title="${t.Role}">${t.Role}</td>
                <td class="${stemClass}">${t.IsSTEM}</td>
            `;
            resultsBody.appendChild(tr);
        });
    }

    // Auto-refresh UI every 1.5 seconds while open
    setInterval(updateUI, 1500);
    updateUI();

    btnStart.addEventListener("click", () => {
        chrome.runtime.sendMessage(
            { action: "START_CRAWL", startUrl: targetUrl },
            updateUI,
        );
    });

    btnPause.addEventListener("click", () => {
        chrome.runtime.sendMessage({ action: "PAUSE_CRAWL" }, updateUI);
    });

    btnResume.addEventListener("click", () => {
        chrome.runtime.sendMessage({ action: "RESUME_CRAWL" }, updateUI);
    });

    btnClear.addEventListener("click", () => {
        if (
            confirm(
                "Are you sure you want to clear all extracted data and reset the crawler?",
            )
        ) {
            chrome.runtime.sendMessage({ action: "CLEAR_DATA" }, updateUI);
        }
    });

    btnExport.addEventListener("click", () => {
        chrome.storage.local.get(["teachers"], (res) => {
            const teachers = res.teachers || [];
            if (teachers.length === 0) return alert("No data to export.");

            const headers = [
                "Name",
                "Email",
                "Role",
                "IsSTEM",
                "ContextSnippet",
                "PageURL",
                "SchoolAddress",
                "CrawledAt",
            ];
            const rows = teachers.map((t) =>
                [
                    `"${(t.Name || "").replace(/"/g, '""')}"`,
                    `"${(t.Email || "").replace(/"/g, '""')}"`,
                    `"${(t.Role || "").replace(/"/g, '""')}"`,
                    `"${t.IsSTEM}"`,
                    `"${(t.ContextSnippet || "").replace(/"/g, '""')}"`,
                    `"${(t.PageURL || "").replace(/"/g, '""')}"`,
                    `"${(t.SchoolAddress || "").replace(/"/g, '""')}"`,
                    `"${t.CrawledAt}"`,
                ].join(","),
            );

            const csvContent = [headers.join(","), ...rows].join("\n");
            const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);

            const a = document.createElement("a");
            a.href = url;
            a.setAttribute(
                "download",
                `all_teachers_${currentDomainEl.textContent}.csv`,
            );
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });
    });
});
