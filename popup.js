import { customSearch, searchHistory } from './search.js';

document.addEventListener('DOMContentLoaded', function () {
    // --- Auto-close functionality for external window ---
    const params = new URLSearchParams(window.location.search);
    const appContainer = document.getElementById('app-container');

    if (params.get('source') === 'window') {
        window.addEventListener('blur', () => {
            // 1. Add the 'closing' class to trigger the fade-out animation
            appContainer.classList.add('closing');

            // 2. Close the window after the animation has finished (150ms)
            setTimeout(() => {
                window.close();
            }, 50);
        });
    }

    const searchInput = document.getElementById('searchInput');
    const bookmarksList = document.getElementById('bookmarksList');
    const historyToggle = document.getElementById('historyToggle');

    let allBookmarks = [];
    let selectedIndex = -1;
    let searchMode = 'bookmarks';
    let domainScores = {};
    let bookmarkTags = {};
    let debounceTimer;
    let activeTagInput = null;
    let isDraggingInTagInput = false;

    const editIconSvg = `<svg viewBox="0 0 20 20"><path fill-rule="evenodd" d="M13.586 3.586a2 2 0 112.828 2.828l-1.06 1.06-2.829-2.828 1.061-1.06zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"></path></svg>`;
    const copyIconSvg = `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z"></path><path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z"></path></svg>`;
    const successIconSvg = `<svg viewBox="0 0 20 20"><path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"></path></svg>`;

    window.addEventListener('mouseup', () => {
        isDraggingInTagInput = false;
    });

    function closeActiveTagInput() {
        if (activeTagInput && activeTagInput.save) {
            activeTagInput.save();
        }
        activeTagInput = null;
    }

    async function saveTagsForUrl(url, tags) {
        if (tags.length > 0) {
            bookmarkTags[url] = tags;
        } else {
            delete bookmarkTags[url];
        }
        await chrome.storage.local.set({ bookmarkTags });
    }

    /**
     * Navigates to the given URL in a new tab after performing security checks.
     * Also tracks the domain for ranking and closes the popup.
     * @param {string} url The URL to navigate to.
     */
    function navigateToUrl(url) {
        try {
            const parsedUrl = new URL(url);
            if (!['http:', 'https:', 'chrome:'].includes(parsedUrl.protocol)) {
                console.warn(`Blocked navigation to a URL with an unsupported protocol: ${url}`);
                return;
            }
        } catch (e) {
            console.warn(`Blocked navigation to an invalid or malformed URL: ${url}`);
            return;
        }
        trackDomainSelection(url);
        chrome.tabs.create({ url: url });
        window.close();
    }

    /**
     * EFFICIENTLY updates the DOM with search results by recycling existing nodes.
     * @param {Array} results The sorted list of search results.
     */
    function displayResults(results) {
        const itemsToDisplay = results.filter(result => result && result.item);
        const isInputEmpty = searchInput.value.trim().length === 0;

        // Hide all existing items first
        const existingItems = bookmarksList.children;
        for (const item of existingItems) {
            item.style.display = 'none';
        }

        if (itemsToDisplay.length === 0) {
            if (!isInputEmpty) {
                let noResultsEl = document.getElementById('no-results-msg');
                if (!noResultsEl) {
                    noResultsEl = document.createElement('div');
                    noResultsEl.className = 'no-results';
                    noResultsEl.id = 'no-results-msg';
                    noResultsEl.textContent = 'No matches found.';
                    bookmarksList.appendChild(noResultsEl);
                }
                noResultsEl.style.display = 'block';
            }
            return;
        }

        const noResultsEl = document.getElementById('no-results-msg');
        if (noResultsEl) noResultsEl.style.display = 'none';

        itemsToDisplay.forEach((result, index) => {
            const bookmark = result.item;
            let bookmarkElement = existingItems[index];

            if (!bookmarkElement || bookmarkElement.id === 'no-results-msg') {
                bookmarkElement = document.createElement('div');
                bookmarkElement.className = 'bookmark-item';
                bookmarkElement.innerHTML = `
                    <img src="" class="favicon">
                    <div class="bookmark-content">
                        <span class="title"></span>
                        <div class="url-display"></div>
                        <div class="history-time" style="display:none;"></div>
                        <div class="bookmark-path" style="display:none;"></div>
                        <div class="tags-container"></div>
                        <input type="text" class="tags-input" style="display:none;" placeholder="Add tags, comma-separated...">
                    </div>
                    <div class="action-buttons">
                        <button class="action-btn copy-url-btn" title="Copy URL">${copyIconSvg}</button>
                        <button class="action-btn edit-tags-btn" title="Edit Tags">${editIconSvg}</button>
                    </div>
                `;
                bookmarksList.appendChild(bookmarkElement);
            }

            bookmarkElement.style.display = 'flex';
            bookmarkElement.dataset.url = bookmark.url;
            bookmarkElement.title = bookmark.url;

            const content = bookmarkElement.querySelector('.bookmark-content');
            const titleEl = content.querySelector('.title');
            const urlEl = content.querySelector('.url-display');
            const pathEl = content.querySelector('.bookmark-path');
            const historyEl = content.querySelector('.history-time');
            const tagsContainer = content.querySelector('.tags-container');

            titleEl.textContent = bookmark.title || bookmark.url;
            urlEl.textContent = bookmark.url.replace(/^(?:https?:\/\/)?(?:www\.)?/i, "");
            bookmarkElement.querySelector('.favicon').src = `https://www.google.com/s2/favicons?sz=16&domain_url=${encodeURIComponent(bookmark.url)}`;

            if (searchMode === 'history') {
                pathEl.style.display = 'none';
                bookmarkElement.querySelector('.action-buttons').style.display = 'none';
                historyEl.style.display = 'block';
                if (bookmark.lastVisitTime) {
                    const visitDate = new Date(bookmark.lastVisitTime);
                    historyEl.textContent = visitDate.toLocaleString(undefined, {
                        year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
                    });
                }
            } else {
                historyEl.style.display = 'none';
                bookmarkElement.querySelector('.action-buttons').style.display = 'flex';
                if (bookmark.path) {
                    pathEl.style.display = 'block';
                    pathEl.textContent = bookmark.path;
                } else {
                    pathEl.style.display = 'none';
                }
                tagsContainer.innerHTML = '';
                
                const tags = bookmarkTags[bookmark.url] || [];
                
                tags.forEach(tagText => {
                    const tagElement = document.createElement('span');
                    tagElement.className = 'tag-pill';
                    tagElement.textContent = tagText;
                    tagsContainer.appendChild(tagElement);
                });
                content.querySelector('.tags-input').value = tags.join(', ');
            }
        });
    }

    function updateSelection() { const items = bookmarksList.querySelectorAll('.bookmark-item'); items.forEach((item, index) => { if (index === selectedIndex) { item.classList.add('selected'); item.scrollIntoView({ block: 'nearest' }); } else { item.classList.remove('selected'); } }); }
    
    async function executeSearch() {
        const query = searchInput.value.trim();
        selectedIndex = -1;

        if (query.startsWith(':')) {
            appContainer.classList.remove('is-searching');
            bookmarksList.innerHTML = '';
            return;
        }
    
        if (query.length > 0) {
            appContainer.classList.add('is-searching');
            let results;
            if (searchMode === 'bookmarks') {
                results = await customSearch(query, allBookmarks, domainScores, bookmarkTags);
            } else {
                results = await searchHistory(query);
            }
            displayResults(results);
    
            if (bookmarksList.querySelector('.bookmark-item[style*="display: flex"]')) {
                selectedIndex = 0;
                updateSelection();
            }
        } else {
            if (searchMode === 'bookmarks') {
                appContainer.classList.add('is-searching');
                const pinTagResults = await customSearch('#pin', allBookmarks, domainScores, bookmarkTags);
                displayResults(pinTagResults);
                if (bookmarksList.querySelector('.bookmark-item[style*="display: flex"]')) {
                    selectedIndex = 0;
                    updateSelection();
                }
            } else {
                appContainer.classList.remove('is-searching');
                bookmarksList.innerHTML = '';
            }
        }
    }

    async function initialize() { 
        const bookmarksData = await chrome.storage.local.get('cachedBookmarks'); 
        if (bookmarksData.cachedBookmarks && bookmarksData.cachedBookmarks.length > 0 && bookmarksData.cachedBookmarks[0].hasOwnProperty('path')) { 
            allBookmarks = bookmarksData.cachedBookmarks; 
        } else { 
            console.warn("Background cache not ready, doing a one-time flatten.");
            const bookmarkTree = await new Promise(resolve => chrome.bookmarks.getTree(resolve)); 
            allBookmarks = (function flattenBookmarks(bookmarkTreeNodes) { const bookmarks = []; function traverse(nodes, path) { for (const node of nodes) { if (node.url) { bookmarks.push({ title: node.title, url: node.url, path: path.join(' / ') }); } if (node.children) { const newPath = node.title ? [...path, node.title] : path; traverse(node.children, newPath); } } } traverse(bookmarkTreeNodes, []); return bookmarks; })(bookmarkTree); 
            chrome.storage.local.set({ cachedBookmarks: allBookmarks }); 
        } 
        const storedData = await chrome.storage.local.get(['domainScores', 'bookmarkTags']); 
        domainScores = storedData.domainScores || {}; 
        bookmarkTags = storedData.bookmarkTags || {}; 
    }
    
    async function trackDomainSelection(urlString) { try { const domain = new URL(urlString).hostname; domainScores[domain] = (domainScores[domain] || 0) + 1; await chrome.storage.local.set({ domainScores: domainScores }); } catch (e) { console.warn("Could not parse URL for domain tracking:", urlString); } }

    initialize().then(() => {
        executeSearch();
    });

    searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(executeSearch, 150);
    });
    
    searchInput.addEventListener('focus', closeActiveTagInput);

    historyToggle.addEventListener('click', function() {
        closeActiveTagInput();
        if (searchMode === 'bookmarks') {
            searchMode = 'history';
            historyToggle.textContent = 'H';
            historyToggle.title = 'Search History';
            historyToggle.classList.add('active');
            searchInput.placeholder = 'Search history, :Google, or ::AI search...';
        } else {
            searchMode = 'bookmarks';
            historyToggle.textContent = 'B';
            historyToggle.title = 'Search Bookmarks';
            historyToggle.classList.remove('active');
            searchInput.placeholder = 'Search bookmarks, #tag, :Google, or ::AI search...';
        }
        searchInput.focus();
        executeSearch();
    });

    // --- EVENT DELEGATION ---
    bookmarksList.addEventListener('mousedown', (e) => {
        if (e.button === 1 && e.target.closest('.bookmark-item')) {
            e.preventDefault();
        }
        if (e.target.closest('.tags-input')) {
            isDraggingInTagInput = true;
        }
    });
    
    bookmarksList.addEventListener('mouseup', (e) => {
        if (isDraggingInTagInput) {
            return;
        }

        const targetItem = e.target.closest('.bookmark-item');
        if (!targetItem) return;
        
        const actionButton = e.target.closest('.action-btn');
        const tagInput = e.target.closest('.tags-input');
        if (actionButton || tagInput) {
            return;
        }

        const url = targetItem.dataset.url;
        const isMiddleClick = e.button === 1;
        const isCtrlClick = e.button === 0 && (e.ctrlKey || e.metaKey);

        if (isMiddleClick || isCtrlClick) {
            trackDomainSelection(url);
            chrome.tabs.create({ url: url, active: false });
        } else if (e.button === 0) {
            navigateToUrl(url);
        }
    });

    bookmarksList.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const copyBtn = e.target.closest('.copy-url-btn');
        const editBtn = e.target.closest('.edit-tags-btn');

        if (copyBtn) {
            const url = e.target.closest('.bookmark-item').dataset.url;
            navigator.clipboard.writeText(url);
            copyBtn.innerHTML = successIconSvg;
            copyBtn.classList.add('success');
            setTimeout(() => { copyBtn.innerHTML = copyIconSvg; copyBtn.classList.remove('success'); }, 1200);
            return;
        }

        if (editBtn) {
            const bookmarkElement = e.target.closest('.bookmark-item');
            const tagsInput = bookmarkElement.querySelector('.tags-input');
            const tagsContainer = bookmarkElement.querySelector('.tags-container');
            const url = bookmarkElement.dataset.url;
            
            const isEditing = tagsInput.style.display === 'block';
            if (isEditing) {
                const newTags = tagsInput.value.split(',').map(t => t.trim()).filter(Boolean);
                saveTagsForUrl(url, newTags);
                tagsContainer.innerHTML = '';
                newTags.forEach(tagText => {
                    const tagElement = document.createElement('span');
                    tagElement.className = 'tag-pill';
                    tagElement.textContent = tagText;
                    tagsContainer.appendChild(tagElement);
                });
                tagsInput.style.display = 'none';
                tagsContainer.style.display = 'flex';
                activeTagInput = null;
            } else {
                closeActiveTagInput();
                tagsInput.style.display = 'block';
                tagsContainer.style.display = 'none';
                tagsInput.focus();
                activeTagInput = { element: tagsInput, save: () => editBtn.click() };
            }
        }
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            window.close();
            return;
        }
        const items = Array.from(bookmarksList.querySelectorAll('.bookmark-item')).filter(item => item.style.display !== 'none');

        if (e.key === 'Enter') {
            e.preventDefault();

            if (activeTagInput) {
                closeActiveTagInput();
                return;
            }

            const query = searchInput.value.trim();
            if (query.startsWith('::')) { const googleQuery = query.substring(2).trim(); if (googleQuery) { const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(googleQuery)}&udm=50`; chrome.tabs.create({ url: searchUrl }); window.close(); } return; }
            if (query.startsWith(':')) { const googleQuery = query.substring(1).trim(); if (googleQuery) { const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(googleQuery)}`; chrome.tabs.create({ url: searchUrl }); window.close(); } return; }

            if (selectedIndex >= 0 && selectedIndex < items.length) {
                const selectedItem = items[selectedIndex];
                const urlToOpen = selectedItem.dataset.url;
                if (urlToOpen) {
                    navigateToUrl(urlToOpen);
                }
            }
        }

        if (items.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = (selectedIndex + 1) % items.length;
            updateSelection();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = (selectedIndex - 1 + items.length) % items.length;
            updateSelection();
        }
    });
});