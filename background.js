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
                    path: path.join(' / ')
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
 * Fetches the entire bookmark tree, flattens it, and stores it in chrome.storage.local.
 */
function buildFullBookmarkCache() {
    console.log("Performing full bookmark cache rebuild...");
    chrome.bookmarks.getTree(async (bookmarkTree) => {
        const flattenedBookmarks = flattenBookmarks(bookmarkTree);
        await chrome.storage.local.set({ cachedBookmarks: flattenedBookmarks });
        console.log("Bookmark cache rebuild complete.");
    });
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

    console.log("Incrementally adding new bookmark...");
    const data = await chrome.storage.local.get({ cachedBookmarks: [] });
    const cachedBookmarks = data.cachedBookmarks;
    const newPathArray = await getFolderPath(bookmark.parentId);

    cachedBookmarks.push({
        title: bookmark.title,
        url: bookmark.url,
        path: newPathArray.join(' / ')
    });

    await chrome.storage.local.set({ cachedBookmarks });
    console.log("Bookmark added to cache.");
}

/**
 * Incrementally removes a single bookmark from the local cache.
 */
async function onBookmarkRemoved(id, removeInfo) {
    if (!removeInfo.node.url) {
        console.log("Folder removed, triggering full cache rebuild.");
        buildFullBookmarkCache();
        return;
    }

    console.log("Incrementally removing bookmark...");
    const data = await chrome.storage.local.get({ cachedBookmarks: [] });
    const cachedBookmarks = data.cachedBookmarks;
    const indexToRemove = cachedBookmarks.findIndex(
        bm => bm.url === removeInfo.node.url && bm.title === removeInfo.node.title
    );

    if (indexToRemove > -1) {
        cachedBookmarks.splice(indexToRemove, 1);
        await chrome.storage.local.set({ cachedBookmarks });
        console.log("Bookmark removed from cache.");
    }
}

/**
 * Incrementally updates a bookmark's title in the cache when it's changed.
 */
async function onBookmarkChanged(id, changeInfo) {
    console.log("Incrementally updating changed bookmark...");
    const data = await chrome.storage.local.get({ cachedBookmarks: [] });
    const cachedBookmarks = data.cachedBookmarks;
    const [bookmarkNode] = await new Promise(resolve => chrome.bookmarks.get(id, resolve));

    if (!bookmarkNode || !bookmarkNode.url) return;

    const bookmarkToUpdate = cachedBookmarks.find(bm => bm.url === bookmarkNode.url);

    if (bookmarkToUpdate) {
        bookmarkToUpdate.title = changeInfo.title;
        await chrome.storage.local.set({ cachedBookmarks });
        console.log("Bookmark title updated in cache.");
    } else {
        buildFullBookmarkCache();
    }
}

/**
 * Incrementally updates a bookmark's path in the cache when it's moved.
 */
async function onBookmarkMoved(id, moveInfo) {
    console.log("Incrementally updating moved bookmark...");
    const data = await chrome.storage.local.get({ cachedBookmarks: [] });
    const cachedBookmarks = data.cachedBookmarks;
    const [bookmarkNode] = await new Promise(resolve => chrome.bookmarks.get(id, resolve));

    if (!bookmarkNode || !bookmarkNode.url) {
        console.log("Folder moved, triggering full cache rebuild.");
        buildFullBookmarkCache();
        return;
    }

    const bookmarkToUpdate = cachedBookmarks.find(bm => bm.url === bookmarkNode.url);

    if (bookmarkToUpdate) {
        const newPathArray = await getFolderPath(moveInfo.parentId);
        bookmarkToUpdate.path = newPathArray.join(' / ');
        await chrome.storage.local.set({ cachedBookmarks });
        console.log("Bookmark path updated in cache.");
    } else {
        buildFullBookmarkCache();
    }
}


// --- Event Listeners ---
chrome.runtime.onInstalled.addListener(buildFullBookmarkCache);
chrome.bookmarks.onCreated.addListener(onBookmarkCreated);
chrome.bookmarks.onRemoved.addListener(onBookmarkRemoved);
chrome.bookmarks.onChanged.addListener(onBookmarkChanged);
chrome.bookmarks.onMoved.addListener(onBookmarkMoved);

// --- Command Listener ---
chrome.commands.onCommand.addListener(async (command) => {
    if (command === "open_popup_window") {
        const [displayInfo] = await chrome.system.display.getInfo();
        const { width: screenWidth, height: screenHeight } = displayInfo.workArea;

        const windowWidth = 414;
        const windowHeight = 477;
        const left = Math.round((screenWidth - windowWidth) / 2);
        const top = Math.round((screenHeight - windowHeight) / 2);

        chrome.windows.create({
            url: "popup.html?source=window",
            type: "popup",
            width: windowWidth,
            height: windowHeight,
            left: left,
            top: top,
            focused: true,
        });
    }
});