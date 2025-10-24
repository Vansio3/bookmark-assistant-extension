// Import our search logic from the new file
import { customSearch, searchHistory } from './search.js';

document.addEventListener('DOMContentLoaded', function () {
    const searchInput = document.getElementById('searchInput');
    const bookmarksList = document.getElementById('bookmarksList');
    const appContainer = document.getElementById('app-container');
    const historyToggle = document.getElementById('historyToggle');

    let allBookmarks = [];
    let selectedIndex = -1;
    let searchMode = 'bookmarks';
    let visitCountCache = {}; // In-memory cache for visit counts
    let debounceTimer;

    /**
     * Renders the search results in the bookmarksList container.
     */
    function displayResults(results) {
        bookmarksList.innerHTML = '';
        const itemsToDisplay = results.filter(result => result && result.item);
        if (itemsToDisplay.length === 0 && searchInput.value.length > 0) {
            bookmarksList.innerHTML = '<div class="no-results">No matches found.</div>';
        } else {
            itemsToDisplay.forEach(function (result) {
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
    
    /**
     * Central function to perform a search based on the current mode.
     */
    async function executeSearch() {
        const query = searchInput.value.trim();
        selectedIndex = -1;
        if (query.length > 0) {
            appContainer.classList.add('is-searching');
            let results;
            if (searchMode === 'bookmarks') {
                results = await customSearch(query, allBookmarks, visitCountCache);
            } else {
                results = await searchHistory(query);
            }
            displayResults(results);
        } else {
            appContainer.classList.remove('is-searching');
            bookmarksList.innerHTML = '';
        }
    }

    // --- Main Execution ---

    /**
     * Initializes the popup by loading bookmarks and the visit count cache.
     */
    async function initialize() {
        // Load bookmarks from cache
        const bookmarksData = await chrome.storage.local.get('cachedBookmarks');
        if (bookmarksData.cachedBookmarks) {
            allBookmarks = bookmarksData.cachedBookmarks;
        } else {
            console.log("Cache miss, building bookmarks from tree for the first time.");
            const bookmarkTree = await new Promise(resolve => chrome.bookmarks.getTree(resolve));
            allBookmarks = flattenBookmarks(bookmarkTree);
            chrome.storage.local.set({ cachedBookmarks: allBookmarks });
        }

        // Load visit count cache from storage
        const cacheData = await chrome.storage.local.get('visitCountCache');
        if (cacheData.visitCountCache) {
            visitCountCache = cacheData.visitCountCache;
        }
    }

    // 1. Initialize data on startup
    initialize();

    // 2. Add DEBOUNCED listener for typing in the search bar
    searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(executeSearch, 150); // Wait 150ms after user stops typing
    });
    
    // 3. Add listener for the history toggle button
    historyToggle.addEventListener('click', function() {
        if (searchMode === 'bookmarks') {
            searchMode = 'history';
            historyToggle.textContent = 'H';
            historyToggle.title = 'Search History';
            historyToggle.classList.add('active');
            searchInput.placeholder = 'Search history...';
        } else {
            searchMode = 'bookmarks';
            historyToggle.textContent = 'B';
            historyToggle.title = 'Search Bookmarks';
            historyToggle.classList.remove('active');
            searchInput.placeholder = 'Search bookmarks...';
        }
        searchInput.focus();
        executeSearch();
    });

    // 4. Add listener for keyboard navigation (unchanged)
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
                // Before closing, save the updated cache
                chrome.storage.local.set({ visitCountCache });
                const urlToOpen = items[selectedIndex].href;
                chrome.tabs.create({ url: urlToOpen });
                window.close();
            }
        }
    });

    // Save the potentially updated cache when the popup is closed
    window.addEventListener('beforeunload', () => {
        chrome.storage.local.set({ visitCountCache });
    });
});