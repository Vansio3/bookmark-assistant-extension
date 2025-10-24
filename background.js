/**
 * Flattens the Chrome bookmark tree into a simple array of bookmark objects.
 * @param {Array} bookmarkNodes The bookmark tree nodes from chrome.bookmarks.getTree.
 * @returns {Array} A flattened array of bookmark objects.
 */
function flattenBookmarks(bookmarkNodes) {
    const bookmarks = [];
    const stack = [...bookmarkNodes];
    while (stack.length > 0) {
        const node = stack.pop();
        if (node.url) {
            bookmarks.push({
                title: node.title,
                url: node.url
            });
        }
        if (node.children) {
            stack.push(...node.children);
        }
    }
    return bookmarks;
}

/**
 * Fetches the bookmark tree, flattens it, and stores it in chrome.storage.local.
 */
async function cacheBookmarks() {
    console.log("Updating bookmark cache...");
    chrome.bookmarks.getTree(async (bookmarkTree) => {
        const flattenedBookmarks = flattenBookmarks(bookmarkTree);
        await chrome.storage.local.set({ cachedBookmarks: flattenedBookmarks });
        console.log("Bookmark cache updated.");
    });
}

// Listener for when the extension is first installed or updated.
chrome.runtime.onInstalled.addListener(cacheBookmarks);

// Listeners for any changes in the bookmarks to trigger a cache update.
chrome.bookmarks.onCreated.addListener(cacheBookmarks);
chrome.bookmarks.onRemoved.addListener(cacheBookmarks);
chrome.bookmarks.onChanged.addListener(cacheBookmarks);
chrome.bookmarks.onMoved.addListener(cacheBookmarks);
chrome.bookmarks.onChildrenReordered.addListener(cacheBookmarks);