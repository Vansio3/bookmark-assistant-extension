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
                const newPath = node.title ? [...path, node.title] : path;
                traverse(node.children, newPath);
            }
        }
    }
    // Start with the top-level nodes and an empty path array.
    traverse(bookmarkTreeNodes, []);
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