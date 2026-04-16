# School STEM Teacher Scraper Chrome Extension

An intelligent Manifest V3 Chrome Extension designed to navigate school websites, auto-discover staff directories, and extract STEM/Math/Science teacher emails securely and politely.

## Features
- **Container-Aware Detection:** Avoids scraping random emails by checking the exact DOM element holding the email for STEM/Science keywords.
- **Auto-Discovery Crawler:** Starts from the school homepage and traverses internal links looking for directories and staff pages.
- **Built-in Rate Limiting:** Crawls with randomized human-like delays (800-2500ms) to respect server load and operates strictly same-origin.
- **Live CSV Export:** Tracks context, role, school address, and URL source.

## Installation
1. Download or copy all files into a folder named `school-stem-scraper-extension`.
2. Ensure the folder structure matches exactly as provided.
3. Open Google Chrome and navigate to `chrome://extensions/`.
4. Enable **Developer mode** (toggle switch in the top right).
5. Click **Load unpacked** and select the `school-stem-scraper-extension` folder.

## How to Use
1. Visit the homepage of a target school or university (e.g., `www.example-school.edu`).
2. Click the extension icon in your Chrome toolbar.
3. Click **Start Crawl**. 
4. The extension will begin operating in the background, opening a hidden tab to process pages one by one.
5. Watch the stats update live in the popup UI. You can pause or resume at any time.
6. Once completed or paused, click **Export CSV** to download the results.

## Disclaimer
Always ensure you have the right to scrape content from the target websites. This tool is designed to be polite (max 120 pages, single concurrent tab), but you are responsible for complying with the site's Terms of Service, `robots.txt`, and applicable data privacy regulations.
