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
            // If it's a bookmark (has a URL), add it to our list with its path.
            if (node.url) {
                bookmarks.push({
                    title: node.title,
                    url: node.url,
                    path: path.join(' / ')
                });
            }
            // If it's a folder (has children), traverse into it.
            if (node.children) {
                // Add the current folder's title to the path for its children.
                // Exclude the root folders which have no title or are system folders.
                const newPath = node.title && node.parentId !== '0' ? [...path, node.title] : path;
                traverse(node.children, newPath);
            }
        }
    }
    // Start with the top-level nodes and an empty path array.
    traverse(bookmarkTreeNodes, []);
    return bookmarks;
}

/**
 * Fetches the entire bookmark tree, flattens it, and stores it in chrome.storage.local.
 * This is used for the initial setup and for complex changes that are hard to track incrementally.
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
    // Traverse up from the parent folder until we hit the root ('0')
    while (currentId && currentId !== '0') {
        const nodes = await new Promise(resolve => chrome.bookmarks.get(currentId, resolve));
        if (nodes && nodes.length > 0) {
            const node = nodes[0];
            // Don't include the names of root folders like "Bookmarks Bar", etc.
            if (node.parentId !== '0') {
                path.unshift(node.title);
            }
            currentId = node.parentId;
        } else {
            break; // Stop if a node is not found
        }
    }
    return path;
}

/**
 * Incrementally adds a newly created bookmark to the local cache.
 */
async function onBookmarkCreated(id, bookmark) {
    // Only act on actual bookmarks with a URL, not folder creation.
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
 * If a folder is removed, it triggers a full cache rebuild for simplicity.
 */
async function onBookmarkRemoved(id, removeInfo) {
    // If a folder was removed (it has no URL), its children are also gone.
    // This is too complex to handle incrementally, so we do a full rebuild.
    if (!removeInfo.node.url) {
        console.log("Folder removed, triggering full cache rebuild.");
        buildFullBookmarkCache();
        return;
    }

    console.log("Incrementally removing bookmark...");
    const data = await chrome.storage.local.get({ cachedBookmarks: [] });
    const cachedBookmarks = data.cachedBookmarks;

    // Find the bookmark to remove by its URL and Title. This is safer than just URL.
    const indexToRemove = cachedBookmarks.findIndex(
        bm => bm.url === removeInfo.node.url && bm.title === removeInfo.node.title
    );

    if (indexToRemove > -1) {
        cachedBookmarks.splice(indexToRemove, 1);
        await chrome.storage.local.set({ cachedBookmarks });
        console.log("Bookmark removed from cache.");
    }
}

// --- Event Listeners ---

// On first install, perform a full build of the cache.
chrome.runtime.onInstalled.addListener(buildFullBookmarkCache);

// Use efficient, incremental updates for simple creation and removal.
chrome.bookmarks.onCreated.addListener(onBookmarkCreated);
chrome.bookmarks.onRemoved.addListener(onBookmarkRemoved);

// For complex changes (renaming, moving), a full rebuild is safer and simpler
// to ensure data integrity, especially regarding paths.
chrome.bookmarks.onChanged.addListener(buildFullBookmarkCache);
chrome.bookmarks.onMoved.addListener(buildFullBookmarkCache);