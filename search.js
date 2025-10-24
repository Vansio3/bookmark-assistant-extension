/**
 * Calculates the Levenshtein distance between two strings.
 * (This function is unchanged)
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
 * (This function is unchanged)
 */
export async function searchHistory(query) {
    return new Promise(resolve => {
        chrome.history.search({
            text: query,
            maxResults: 50,
            startTime: 0
        }, (historyItems) => {
            const formattedResults = historyItems.map(historyItem => ({
                item: {
                    title: historyItem.title || historyItem.url,
                    url: historyItem.url
                }
            }));
            resolve(formattedResults);
        });
    });
}


/**
 * Performs an OPTIMIZED fuzzy search on bookmarks using a two-pass system.
 * It first finds the best matches by text, then enriches a small subset with visit counts.
 * @param {string} query The search query.
 * @param {Array} allBookmarks The list of all bookmarks to search through.
 * @param {Object} visitCountCache A cache object to read/write visit counts.
 * @returns {Promise<Array>} A sorted array of matching bookmark objects.
 */
export async function customSearch(query, allBookmarks, visitCountCache) {
    const lowerCaseQuery = query.toLowerCase();
    const queryWords = lowerCaseQuery.split(' ').filter(w => w);
    
    // --- Pass 1: Quick text-based search and scoring ---
    const preliminaryResults = [];
    for (const bookmark of allBookmarks) {
        const lowerCaseTitle = bookmark.title.toLowerCase();
        let score = 0;
        const matchedWords = new Set();

        for (const word of queryWords) {
            if (lowerCaseTitle.includes(word)) {
                score += 10;
                if (lowerCaseTitle.split(' ').some(titleWord => titleWord.startsWith(word))) {
                    score += 15;
                }
                matchedWords.add(word);
            } else if (bookmark.url.toLowerCase().includes(word)) {
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
            if (matchedWords.size === queryWords.length && queryWords.length > 1) {
                score *= 1.5;
            }
            preliminaryResults.push({ item: bookmark, score });
        }
    }

    // Sort the preliminary results to find the best candidates
    preliminaryResults.sort((a, b) => b.score - a.score);

    // --- Pass 2: Enrich the top N results with expensive history lookups ---
    const topResults = preliminaryResults.slice(0, 25); // Only enhance the top 25
    const historyPromises = [];
    const CACHE_TTL = 1000 * 60 * 60 * 24; // Cache for 24 hours

    for (const result of topResults) {
        const url = result.item.url;
        
        // Caching Logic
        const cached = visitCountCache[url];
        if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
            result.score += Math.log(cached.visitCount + 1) * 5;
            continue; // Use cached value and skip the API call
        }

        // If not in cache or expired, fetch it
        const historyPromise = new Promise(resolve => {
            chrome.history.getVisits({ url: url }, (visitItems) => {
                const visitCount = visitItems ? visitItems.length : 0;
                if (visitCount > 0) {
                    result.score += Math.log(visitCount + 1) * 5;
                    // Update cache
                    visitCountCache[url] = { visitCount: visitCount, timestamp: Date.now() };
                }
                resolve();
            });
        });
        historyPromises.push(historyPromise);
    }
    
    // Wait for ONLY the necessary history lookups to complete
    await Promise.all(historyPromises);

    // Final sort after enrichment
    topResults.sort((a, b) => b.score - a.score);

    return topResults;
}