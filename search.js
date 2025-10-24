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
 * It incorporates configurable weights, recency, and domain boosting.
 * @param {string} query The search query.
 * @param {Array} allBookmarks The list of all bookmarks to search through.
 * @param {Object} visitCountCache A cache object to read/write visit counts.
 * @param {Object} domainScores A map of domain visit counts for boosting.
 * @returns {Promise<Array>} A sorted array of matching bookmark objects.
 */
export async function customSearch(query, allBookmarks, visitCountCache, domainScores) {
    // --- Load configurable weights from storage with defaults ---
    const { weights } = await chrome.storage.sync.get({
        weights: {
            titleMatch: 10, startsWithBonus: 15, urlMatch: 3, allWordsBonus: 1.5,
            visitCount: 5, recency: 10
        }
    });

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
                score += weights.titleMatch;
                if (lowerCaseTitle.split(' ').some(titleWord => titleWord.startsWith(word))) {
                    score += weights.startsWithBonus;
                }
                matchedWords.add(word);
            } else if (bookmark.url.toLowerCase().includes(word)) {
                score += weights.urlMatch;
                matchedWords.add(word);
            }
        }
        
        if (matchedWords.size < queryWords.length) {
            const distance = levenshteinDistance(lowerCaseQuery, lowerCaseTitle.substring(0, lowerCaseQuery.length));
            if (distance <= Math.floor(lowerCaseQuery.length / 4)) {
                score += 20 - distance * 5; // Using a static Levenshtein bonus for now
            }
        }

        if (score > 0) {
            if (matchedWords.size === queryWords.length && queryWords.length > 1) {
                score *= weights.allWordsBonus;
            }

            // --- Domain-Specific Boosting ---
            try {
                const domain = new URL(bookmark.url).hostname;
                if (domainScores[domain]) {
                    // Apply a gentle, logarithmic boost based on how many times you've picked this domain
                    score *= (1 + Math.log1p(domainScores[domain]) * 0.1);
                }
            } catch (e) { /* Invalid URL, ignore */ }
            
            preliminaryResults.push({ item: bookmark, score });
        }
    }

    preliminaryResults.sort((a, b) => b.score - a.score);

    // --- Pass 2: Enrich the top N results with visit counts and recency ---
    const topResults = preliminaryResults.slice(0, 25);
    const historyPromises = [];
    const CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours

    for (const result of topResults) {
        const url = result.item.url;
        const cached = visitCountCache[url];

        if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
            result.score += Math.log(cached.visitCount + 1) * weights.visitCount;
            if (cached.lastVisit) {
                const daysAgo = (Date.now() - cached.lastVisit) / (1000 * 60 * 60 * 24);
                result.score += Math.max(0, weights.recency - daysAgo); // Decaying bonus
            }
            continue;
        }

        const historyPromise = new Promise(resolve => {
            chrome.history.getVisits({ url: url }, (visitItems) => {
                const visitCount = visitItems ? visitItems.length : 0;
                if (visitCount > 0) {
                    result.score += Math.log(visitCount + 1) * weights.visitCount;
                    
                    // --- Recency Score Calculation ---
                    const lastVisit = visitItems[0].visitTime; // API returns in reverse chronological order
                    const daysAgo = (Date.now() - lastVisit) / (1000 * 60 * 60 * 24);
                    result.score += Math.max(0, weights.recency - daysAgo); // Decaying bonus

                    visitCountCache[url] = { visitCount, lastVisit, timestamp: Date.now() };
                }
                resolve();
            });
        });
        historyPromises.push(historyPromise);
    }
    
    await Promise.all(historyPromises);
    topResults.sort((a, b) => b.score - a.score);
    return topResults;
}