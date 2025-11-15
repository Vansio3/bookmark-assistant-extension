/**
 * Flattens the Chrome bookmark tree into a simple array of bookmark objects,
 * including the full folder path for each bookmark.
 * @param {Array} bookmarkTreeNodes The bookmark tree nodes from chrome.bookmarks.getTree.
 * @returns {Array} A flattened array of bookmark objects with titles, URLs, and paths.
 */
function flattenBookmarks(bookmarkTreeNodes) {
    const bookmarks = [];

    function traverse(nodes, path) {
        for (const node of nodes) {
            if (node.url) {
                bookmarks.push({
                    title: node.title,
                    url: node.url,
                    path: path.join(' / '),
                    visitCount: 0,
                    lastVisitTime: 0
                });
            }
            if (node.children) {
                const newPath = node.title && node.parentId !== '0' ? [...path, node.title] : path;
                traverse(node.children, newPath);
            }
        }
    }
    traverse(bookmarkTreeNodes, []);
    return bookmarks;
}

/**
 * Iterates through a list of bookmarks and adds visitCount and lastVisitTime from the History API.
 * This is an expensive operation and should only be run once during initial setup.
 * @param {Array} bookmarks The array of bookmark objects to enrich.
 * @returns {Promise<Array>} The enriched array of bookmarks.
 */
async function populateHistoryDataForBookmarks(bookmarks) {
    for (const bookmark of bookmarks) {
        if (bookmark.visitCount > 0) continue;

        const historyItems = await new Promise(resolve => {
            chrome.history.getVisits({ url: bookmark.url }, resolve);
        });

        if (historyItems && historyItems.length > 0) {
            bookmark.visitCount = historyItems.length;
            bookmark.lastVisitTime = historyItems[0].visitTime;
        }
    }
    return bookmarks;
}

/**
 * Fetches the entire bookmark tree, flattens it, populates its history,
 * and stores it in chrome.storage.local.
 */
async function buildFullBookmarkCache() {
    console.log("Building full bookmark cache...");
    chrome.bookmarks.getTree(async (bookmarkTree) => {
        let flattenedBookmarks = flattenBookmarks(bookmarkTree);
        // This is the new, expensive step that runs once in the background.
        flattenedBookmarks = await populateHistoryDataForBookmarks(flattenedBookmarks);
        await chrome.storage.local.set({ cachedBookmarks: flattenedBookmarks });
        console.log("Bookmark cache build complete.");
    });
}

/**
 * Handles a new visit to a URL, updating the visit count and last visit time
 * for any matching bookmarks in the cache.
 * @param {chrome.history.HistoryItem} historyItem The item that was visited.
 */
async function handleVisit(historyItem) {
    const { cachedBookmarks } = await chrome.storage.local.get({ cachedBookmarks: [] });
    let updated = false;

    const matchingBookmarks = cachedBookmarks.filter(bm => bm.url === historyItem.url);

    if (matchingBookmarks.length > 0) {
        const visitItems = await new Promise(resolve => {
            chrome.history.getVisits({ url: historyItem.url }, resolve);
        });
        
        if (visitItems && visitItems.length > 0) {
            for (const bookmark of matchingBookmarks) {
                bookmark.visitCount = visitItems.length;
                bookmark.lastVisitTime = visitItems[0].visitTime;
                updated = true;
            }
        }
    }
    
    if (updated) {
        await chrome.storage.local.set({ cachedBookmarks });
    }
}


/**
 * Traverses up the bookmark tree from a given folder ID to construct its full path.
 * @param {string} folderId The ID of the starting folder.
 * @returns {Promise<Array<string>>} A promise that resolves to an array of folder names.
 */
async function getFolderPath(folderId) {
    const path = [];
    let currentId = folderId;
    while (currentId && currentId !== '0') {
        const nodes = await new Promise(resolve => chrome.bookmarks.get(currentId, resolve));
        if (nodes && nodes.length > 0) {
            const node = nodes[0];
            if (node.parentId !== '0') {
                path.unshift(node.title);
            }
            currentId = node.parentId;
        } else {
            break;
        }
    }
    return path;
}

/**
 * Incrementally adds a newly created bookmark to the local cache.
 */
async function onBookmarkCreated(id, bookmark) {
    if (!bookmark.url) return;

    const data = await chrome.storage.local.get({ cachedBookmarks: [] });
    const cachedBookmarks = data.cachedBookmarks;
    const newPathArray = await getFolderPath(bookmark.parentId);

    cachedBookmarks.push({
        title: bookmark.title,
        url: bookmark.url,
        path: newPathArray.join(' / '),
        visitCount: 0,
        lastVisitTime: 0
    });

    await chrome.storage.local.set({ cachedBookmarks });
}

/**
 * Incrementally removes a single bookmark from the local cache.
 */
async function onBookmarkRemoved(id, removeInfo) {
    if (!removeInfo.node.url) {
        buildFullBookmarkCache();
        return;
    }

    const data = await chrome.storage.local.get({ cachedBookmarks: [] });
    const cachedBookmarks = data.cachedBookmarks;
    const indexToRemove = cachedBookmarks.findIndex(
        bm => bm.url === removeInfo.node.url && bm.title === removeInfo.node.title
    );

    if (indexToRemove > -1) {
        cachedBookmarks.splice(indexToRemove, 1);
        await chrome.storage.local.set({ cachedBookmarks });
    }
}

/**
 * Incrementally updates a bookmark's title in the cache when it's changed.
 */
async function onBookmarkChanged(id, changeInfo) {
    const data = await chrome.storage.local.get({ cachedBookmarks: [] });
    const cachedBookmarks = data.cachedBookmarks;
    const [bookmarkNode] = await new Promise(resolve => chrome.bookmarks.get(id, resolve));

    if (!bookmarkNode || !bookmarkNode.url) return;

    const bookmarksToUpdate = cachedBookmarks.filter(bm => bm.url === bookmarkNode.url);

    if (bookmarksToUpdate.length > 0) {
        for (const bm of bookmarksToUpdate) {
            bm.title = changeInfo.title;
        }
        await chrome.storage.local.set({ cachedBookmarks });
    } else {
        buildFullBookmarkCache();
    }
}

/**
 * Incrementally updates a bookmark's path in the cache when it's moved.
 */
async function onBookmarkMoved(id, moveInfo) {
    const data = await chrome.storage.local.get({ cachedBookmarks: [] });
    const cachedBookmarks = data.cachedBookmarks;
    const [bookmarkNode] = await new Promise(resolve => chrome.bookmarks.get(id, resolve));

    if (!bookmarkNode || !bookmarkNode.url) {
        buildFullBookmarkCache();
        return;
    }

    buildFullBookmarkCache();
}

// --- Singleton Popup Window Management ---
let popupWindowId = null;

async function createPopupWindow() {
    // 1. Get all available display information
    const allDisplays = await chrome.system.display.getInfo();

    // 2. Get the last window the user was interacting with
    const lastFocused = await new Promise(resolve => chrome.windows.getLastFocused(resolve));

    let targetDisplay = allDisplays[0]; // Default to primary display

    // 3. If there was a focused window, find which display it was on
    if (lastFocused) {
        const windowCenterX = lastFocused.left + lastFocused.width / 2;
        const windowCenterY = lastFocused.top + lastFocused.height / 2;

        const display = allDisplays.find(d => 
            windowCenterX >= d.workArea.left && windowCenterX < d.workArea.left + d.workArea.width &&
            windowCenterY >= d.workArea.top && windowCenterY < d.workArea.top + d.workArea.height
        );

        if (display) {
            targetDisplay = display;
        }
    }

    // 4. Use the target display's work area to center the popup
    const { workArea } = targetDisplay;
    const windowWidth = 414;
    const windowHeight = 477;

    // Center the new window on the target display
    const left = Math.round(workArea.left + (workArea.width - windowWidth) / 2);
    const top = Math.round(workArea.top + (workArea.height - windowHeight) / 2);

    chrome.windows.create({
        url: "popup.html?source=window",
        type: "popup",
        width: windowWidth,
        height: windowHeight,
        left: left,
        top: top,
        focused: true,
    }, (window) => {
        if (window) {
            popupWindowId = window.id;
        }
    });
}

// --- Event Listeners ---
chrome.runtime.onInstalled.addListener((details) => {
    chrome.contextMenus.create({
        id: "open-welcome-page",
        title: "Help Guide",
        contexts: ["action"]
    });
    if (details.reason === 'install') {
        chrome.tabs.create({ url: 'welcome.html' });
    }
    buildFullBookmarkCache();
});
chrome.bookmarks.onCreated.addListener(onBookmarkCreated);
chrome.bookmarks.onRemoved.addListener(onBookmarkRemoved);
chrome.bookmarks.onChanged.addListener(onBookmarkChanged);
chrome.bookmarks.onMoved.addListener(onBookmarkMoved);
chrome.history.onVisited.addListener(handleVisit);

chrome.windows.onRemoved.addListener((windowId) => {
    if (windowId === popupWindowId) {
        popupWindowId = null;
    }
});

// --- Command Listener ---
chrome.commands.onCommand.addListener(async (command) => {
    if (command === "open_popup_window") {
        if (popupWindowId !== null) {
            chrome.windows.get(popupWindowId, (existingWindow) => {
                if (chrome.runtime.lastError) {
                    createPopupWindow();
                } else {
                    chrome.windows.update(popupWindowId, { focused: true });
                }
            });
        } else {
            createPopupWindow();
        }
    }
});

// --- Context Menu Listener ---
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "open-welcome-page") {
        const welcomeUrl = chrome.runtime.getURL('welcome.html');

        chrome.tabs.query({ url: welcomeUrl }, (tabs) => {
            if (tabs.length > 0) {
                chrome.tabs.update(tabs[0].id, { active: true });
            } else {
                chrome.tabs.create({ url: welcomeUrl });
            }
        });
    }
});