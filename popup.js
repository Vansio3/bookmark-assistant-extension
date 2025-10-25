import { customSearch, searchHistory } from './search.js';

document.addEventListener('DOMContentLoaded', function () {
    const searchInput = document.getElementById('searchInput');
    const bookmarksList = document.getElementById('bookmarksList');
    const appContainer = document.getElementById('app-container');
    const historyToggle = document.getElementById('historyToggle');

    let allBookmarks = [];
    let selectedIndex = -1;
    let searchMode = 'bookmarks';
    let visitCountCache = {};
    let domainScores = {};
    let bookmarkTags = {};
    let debounceTimer;
    let activeTagInput = null;

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
     * Centralized function to handle navigation.
     */
    function navigateToUrl(url) {
        if (!url.startsWith('http:') && !url.startsWith('https:') && !url.startsWith('chrome:')) {
            console.warn(`Blocked navigation to potentially unsafe URL: ${url}`);
            return;
        }
        
        trackDomainSelection(url);
        chrome.storage.local.set({ visitCountCache });
        chrome.tabs.create({ url: url });
        window.close();
    }

    function displayResults(results) {
        bookmarksList.innerHTML = '';
        const itemsToDisplay = results.filter(result => result && result.item);
        const isInputEmpty = searchInput.value.trim().length === 0;

        // Handle the "No Results" case for active searches
        if (itemsToDisplay.length === 0) {
            if (!isInputEmpty) {
                bookmarksList.innerHTML = '<div class="no-results">No matches found.</div>';
            }
            return;
        }

        const editIconSvg = `<svg viewBox="0 0 20 20"><path fill-rule="evenodd" d="M13.586 3.586a2 2 0 112.828 2.828l-1.06 1.06-2.829-2.828 1.061-1.06zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"></path></svg>`;

        itemsToDisplay.forEach((result) => {
            const bookmark = result.item;
            
            const bookmarkElement = document.createElement('div');
            bookmarkElement.className = 'bookmark-item';
            bookmarkElement.dataset.url = bookmark.url;
            bookmarkElement.title = bookmark.url;

            bookmarkElement.addEventListener('mousedown', (e) => {
                if (e.target.closest('.edit-tags-btn')) {
                    return;
                }

                const url = bookmark.url;
                const isMiddleClick = e.button === 1;
                const isCtrlClick = e.button === 0 && (e.ctrlKey || e.metaKey);

                if (isMiddleClick || isCtrlClick) {
                    e.preventDefault();
                    trackDomainSelection(url);
                    chrome.tabs.create({ url: url, active: false });
                }
                else if (e.button === 0) {
                    navigateToUrl(url);
                }
            });

            const favicon = document.createElement('img');
            favicon.src = `https://www.google.com/s2/favicons?sz=16&domain_url=${encodeURIComponent(bookmark.url)}`;
            favicon.onerror = function() { this.style.display='none'; };
            bookmarkElement.appendChild(favicon);

            const content = document.createElement('div');
            content.className = 'bookmark-content';

            const title = document.createElement('span');
            title.textContent = bookmark.title || bookmark.url;
            title.className = 'title';
            content.appendChild(title);

            if (searchMode === 'history') {
                const historyTime = document.createElement('div');
                historyTime.className = 'history-time';
                if (bookmark.lastVisitTime) {
                    const visitDate = new Date(bookmark.lastVisitTime);
                    historyTime.textContent = visitDate.toLocaleString(undefined, {
                        year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
                    });
                }
                content.appendChild(historyTime);
                bookmarkElement.appendChild(content);

            } else {
                if (bookmark.path) {
                    const bookmarkPath = document.createElement('div');
                    bookmarkPath.className = 'bookmark-path';
                    bookmarkPath.textContent = bookmark.path;
                    content.appendChild(bookmarkPath);
                }

                const tags = bookmarkTags[bookmark.url] || [];
                const tagsContainer = document.createElement('div');
                tagsContainer.className = 'tags-container';
                
                const tagsInput = document.createElement('input');
                tagsInput.type = 'text';
                tagsInput.className = 'tags-input';
                tagsInput.placeholder = 'Add tags, comma-separated...';
                tagsInput.style.display = 'none';
                tagsInput.value = tags.join(', ');

                tagsInput.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                });

                const renderTags = (currentTags) => {
                    tagsContainer.innerHTML = '';
                    currentTags.forEach(tag => {
                        const tagPill = document.createElement('span');
                        tagPill.className = 'tag-pill';
                        tagPill.textContent = tag;
                        tagsContainer.appendChild(tagPill);
                    });
                };
                renderTags(tags);
                content.appendChild(tagsContainer);
                content.appendChild(tagsInput);
                bookmarkElement.appendChild(content);

                const editButton = document.createElement('button');
                editButton.className = 'edit-tags-btn';
                editButton.innerHTML = editIconSvg;
                editButton.title = 'Edit Tags';
                
                editButton.addEventListener('click', (e) => {
                    e.preventDefault();
                    const isEditing = tagsInput.style.display === 'block';
                    if (isEditing) {
                        const newTags = tagsInput.value.split(',').map(t => t.trim()).filter(Boolean);
                        saveTagsForUrl(bookmark.url, newTags);
                        renderTags(newTags);
                        tagsInput.style.display = 'none';
                        tagsContainer.style.display = 'flex';
                        activeTagInput = null;
                    } else {
                        closeActiveTagInput();
                        tagsInput.style.display = 'block';
                        tagsContainer.style.display = 'none';
                        tagsInput.focus();
                        activeTagInput = {
                            element: tagsInput,
                            save: () => editButton.click()
                        };
                    }
                });
                bookmarkElement.appendChild(editButton);

                tagsInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        e.stopPropagation();
                        editButton.click();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        tagsInput.value = tags.join(', ');
                        tagsInput.style.display = 'none';
                        tagsContainer.style.display = 'flex';
                        activeTagInput = null;
                    }
                });
            }

            bookmarksList.appendChild(bookmarkElement);
        });
    }

    function updateSelection() { const items = bookmarksList.querySelectorAll('.bookmark-item'); items.forEach((item, index) => { if (index === selectedIndex) { item.classList.add('selected'); item.scrollIntoView({ block: 'nearest' }); } else { item.classList.remove('selected'); } }); }
    function flattenBookmarks(bookmarkTreeNodes) { const bookmarks = []; function traverse(nodes, path) { for (const node of nodes) { if (node.url) { bookmarks.push({ title: node.title, url: node.url, path: path.join(' / ') }); } if (node.children) { const newPath = node.title ? [...path, node.title] : path; traverse(node.children, newPath); } } } traverse(bookmarkTreeNodes, []); return bookmarks; }
    
    async function executeSearch() {
        const query = searchInput.value.trim();
        selectedIndex = -1;
    
        if (query.length > 0) {
            appContainer.classList.add('is-searching');
            let results;
            if (searchMode === 'bookmarks') {
                results = await customSearch(query, allBookmarks, visitCountCache, domainScores, bookmarkTags);
            } else {
                results = await searchHistory(query);
            }
            displayResults(results);
    
            if (bookmarksList.querySelector('.bookmark-item')) {
                selectedIndex = 0;
                updateSelection();
            }
        } else {
            // This is the empty state. Show #pin tags or clear list.
            if (searchMode === 'bookmarks') {
                appContainer.classList.add('is-searching');
                const pinTagResults = await customSearch('#pin', allBookmarks, visitCountCache, domainScores, bookmarkTags);
                displayResults(pinTagResults);
                if (bookmarksList.querySelector('.bookmark-item')) {
                    selectedIndex = 0;
                    updateSelection();
                }
            } else {
                // Empty state for history search
                appContainer.classList.remove('is-searching');
                bookmarksList.innerHTML = '';
            }
        }
    }

    async function initialize() { const bookmarksData = await chrome.storage.local.get('cachedBookmarks'); if (bookmarksData.cachedBookmarks && bookmarksData.cachedBookmarks.length > 0 && bookmarksData.cachedBookmarks[0].hasOwnProperty('path')) { allBookmarks = bookmarksData.cachedBookmarks; } else { const bookmarkTree = await new Promise(resolve => chrome.bookmarks.getTree(resolve)); allBookmarks = flattenBookmarks(bookmarkTree); chrome.storage.local.set({ cachedBookmarks: allBookmarks }); } const storedData = await chrome.storage.local.get(['visitCountCache', 'domainScores', 'bookmarkTags']); visitCountCache = storedData.visitCountCache || {}; domainScores = storedData.domainScores || {}; bookmarkTags = storedData.bookmarkTags || {}; }
    async function trackDomainSelection(urlString) { try { const domain = new URL(urlString).hostname; domainScores[domain] = (domainScores[domain] || 0) + 1; await chrome.storage.local.set({ domainScores: domainScores }); } catch (e) { console.warn("Could not parse URL for domain tracking:", urlString); } }

    initialize().then(() => {
        // Perform an initial search to populate the empty state view
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
            searchInput.placeholder = 'Search history...';
        } else {
            searchMode = 'bookmarks';
            historyToggle.textContent = 'B';
            historyToggle.title = 'Search Bookmarks';
            historyToggle.classList.remove('active');
            searchInput.placeholder = 'Search bookmarks (#tag to filter)...';
        }
        searchInput.focus();
        executeSearch();
    });

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
                const selectedItem = items[selectedIndex];
                const isEditingTags = selectedItem.querySelector('.tags-input')?.style.display === 'block';
                if (isEditingTags) {
                    return; 
                }
                
                const urlToOpen = selectedItem.dataset.url;
                if (urlToOpen) {
                    navigateToUrl(urlToOpen);
                }
            }
        }
    });

    window.addEventListener('beforeunload', () => {
        chrome.storage.local.set({ visitCountCache });
    });
});