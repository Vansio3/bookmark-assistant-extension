// Import our search logic from the new file
import { customSearch } from './search.js';

document.addEventListener('DOMContentLoaded', function () {
    const searchInput = document.getElementById('searchInput');
    const bookmarksList = document.getElementById('bookmarksList');
    const appContainer = document.getElementById('app-container');
    let allBookmarks = [];
    let selectedIndex = -1;

    /**
     * Renders the search results in the bookmarksList container.
     */
    function displayResults(results) {
        bookmarksList.innerHTML = '';
        if (results.length === 0 && searchInput.value.length > 0) {
            bookmarksList.innerHTML = '<div class="no-results">No matches found.</div>';
        } else {
            results.forEach(function (result) {
                const bookmark = result.item;
                const bookmarkElement = document.createElement('a');
                bookmarkElement.href = bookmark.url;
                bookmarkElement.className = 'bookmark-item';
                bookmarkElement.target = '_blank';
                bookmarkElement.title = bookmark.url;

                const favicon = document.createElement('img');
                favicon.src = `https://www.google.com/s2/favicons?sz=16&domain_url=${encodeURIComponent(bookmark.url)}`;
                favicon.onerror = function() { this.style.display='none'; };

                const title = document.createElement('span');
                title.textContent = bookmark.title || bookmark.url;
                title.className = 'title';

                bookmarkElement.appendChild(favicon);
                bookmarkElement.appendChild(title);
                bookmarksList.appendChild(bookmarkElement);
            });
        }
    }

    /**
     * Updates the visual style of the selected item.
     */
    function updateSelection() {
        const items = bookmarksList.querySelectorAll('.bookmark-item');
        items.forEach((item, index) => {
            if (index === selectedIndex) {
                item.classList.add('selected');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.classList.remove('selected');
            }
        });
    }

    /**
     * Flattens the Chrome bookmark tree for the fallback scenario.
     */
    function flattenBookmarks(bookmarkNodes) {
        const bookmarks = [];
        const stack = [...bookmarkNodes];
        while (stack.length > 0) {
            const node = stack.pop();
            if (node.url) {
                bookmarks.push({ title: node.title, url: node.url });
            }
            if (node.children) {
                stack.push(...node.children);
            }
        }
        return bookmarks;
    }

    // --- Main Execution ---

    /**
     * Initializes the popup by loading bookmarks from cache or building it if it doesn't exist.
     */
    async function initialize() {
        const data = await chrome.storage.local.get('cachedBookmarks');
        if (data.cachedBookmarks) {
            allBookmarks = data.cachedBookmarks;
        } else {
            // Fallback in case the cache is empty on the very first run
            console.log("Cache miss, building bookmarks from tree for the first time.");
            // Promisify the callback-based chrome.bookmarks.getTree API
            const bookmarkTree = await new Promise(resolve => chrome.bookmarks.getTree(resolve));
            allBookmarks = flattenBookmarks(bookmarkTree);
            // Don't wait for this to complete to show the UI
            chrome.storage.local.set({ cachedBookmarks: allBookmarks });
        }
    }

    // 1. Load bookmarks from cache on startup and then set up listeners
    initialize();

    // 2. Add listener for typing in the search bar
    searchInput.addEventListener('input', async function () {
        const query = this.value.trim();
        selectedIndex = -1; // Reset selection on new search
        if (query.length > 0) {
            appContainer.classList.add('is-searching');
            const results = await customSearch(query, allBookmarks);
            displayResults(results);
        } else {
            appContainer.classList.remove('is-searching');
            bookmarksList.innerHTML = '';
        }
    });

    // 3. Add listener for keyboard navigation
    document.addEventListener('keydown', function (e) {
        const items = bookmarksList.querySelectorAll('.bookmark-item');
        if (items.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = (selectedIndex + 1) % items.length;
            updateSelection();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = (selectedIndex - 1 + items.length) % items.length;
            updateSelection();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (selectedIndex >= 0 && selectedIndex < items.length) {
                const urlToOpen = items[selectedIndex].href;
                chrome.tabs.create({ url: urlToOpen });
                window.close(); // Close the popup after opening a tab
            }
        }
    });
});