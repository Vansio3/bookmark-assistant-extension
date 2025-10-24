/**
 * Calculates the Levenshtein distance between two strings.
 * This is a measure of the difference between two sequences.
 * @param {string} s1 The first string.
 * @param {string} s2 The second string.
 * @returns {number} The Levenshtein distance.
 */
function levenshteinDistance(s1, s2) {
    s1 = s1.toLowerCase();
    s2 = s2.toLowerCase();

    const costs = [];
    for (let i = 0; i <= s1.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= s2.length; j++) {
            if (i === 0) {
                costs[j] = j;
            } else {
                if (j > 0) {
                    let newValue = costs[j - 1];
                    if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
                        newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                    }
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
        }
        if (i > 0) {
            costs[s2.length] = lastValue;
        }
    }
    return costs[s2.length];
}

/**
 * Flattens the Chrome bookmark tree into a simple array of bookmark objects.
 * (This function is unchanged)
 */
export function flattenBookmarks(bookmarkNodes) {
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
 * Searches the user's browser history using the efficient chrome.history API.
 * @param {string} query The search query.
 * @returns {Promise<Array>} A sorted array of matching history objects, formatted for display.
 */
export async function searchHistory(query) {
    return new Promise(resolve => {
        chrome.history.search({
            text: query,
            maxResults: 50, // Limit results for performance and relevance
            startTime: 0 // Search all available history
        }, (historyItems) => {
            // The display function expects an array of objects, where each object has an 'item' property.
            const formattedResults = historyItems.map(historyItem => {
                return {
                    item: {
                        title: historyItem.title || historyItem.url,
                        url: historyItem.url
                    }
                };
            });
            resolve(formattedResults);
        });
    });
}


/**
 * Performs an advanced fuzzy search on a bookmarks list with a sophisticated scoring system.
 * It now searches both title and URL with different weights and prioritizes frequently visited sites.
 * @param {string} query The search query.
 * @param {Array} allBookmarks The list of all bookmarks to search through.
 * @returns {Promise<Array>} A sorted array of matching bookmark objects.
 */
export async function customSearch(query, allBookmarks) {
    const lowerCaseQuery = query.toLowerCase();
    const queryWords = lowerCaseQuery.split(' ').filter(w => w);
    const results = [];
    const historyPromises = []; // To hold all our history search promises

    for (const bookmark of allBookmarks) {
        const lowerCaseTitle = bookmark.title.toLowerCase();
        const lowerCaseUrl = bookmark.url.toLowerCase();
        let score = 0;
        const matchedWords = new Set();

        for (const word of queryWords) {
            const inTitle = lowerCaseTitle.includes(word);
            const inUrl = lowerCaseUrl.includes(word);

            if (inTitle) {
                score += 10;
                if (lowerCaseTitle.split(' ').some(titleWord => titleWord.startsWith(word))) {
                    score += 15;
                }
                matchedWords.add(word);
            } else if (inUrl) {
                score += 3;
                matchedWords.add(word);
            }
        }

        if (matchedWords.size < queryWords.length) {
            const distance = levenshteinDistance(lowerCaseQuery, lowerCaseTitle.substring(0, lowerCaseQuery.length));
            if (distance <= Math.floor(lowerCaseQuery.length / 4)) {
                score += 20 - distance * 5;
            }
        }

        if (score > 0) {
            score += 5 / lowerCaseTitle.length;
        }

        if (matchedWords.size === queryWords.length && queryWords.length > 1) {
            score *= 1.5;
        }

        if (score > 0) {
            // Create a promise to get the visit count and push it to an array
            const historyPromise = new Promise(resolve => {
                chrome.history.getVisits({ url: bookmark.url }, (visitItems) => {
                    if (visitItems && visitItems.length > 0) {
                        // Using a logarithmic scale to give a boost that diminishes as the visit count gets very high
                        score += Math.log(visitItems.length + 1) * 5;
                    }
                    results.push({ item: bookmark, score: score });
                    resolve();
                });
            });
            historyPromises.push(historyPromise);
        }
    }
    
    // Wait for all the history lookups to complete
    await Promise.all(historyPromises);

    results.sort((a, b) => b.score - a.score);

    return results.slice(0, 50);
}