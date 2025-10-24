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
 * Searches the user's browser history using the efficient chrome.history API.
 * Now includes the last visit time in the results.
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
                    url: historyItem.url,
                    lastVisitTime: historyItem.lastVisitTime
                }
            }));
            resolve(formattedResults);
        });
    });
}

/**
 * Performs an OPTIMIZED fuzzy search on bookmarks, now with tag support.
 * It filters by tags (#tag) and adds score for tag keyword matches.
 * @param {string} query The search query.
 * @param {Array} allBookmarks The list of all bookmarks to search through.
 * @param {Object} visitCountCache A cache object to read/write visit counts.
 * @param {Object} domainScores A map of domain visit counts for boosting.
 * @param {Object} bookmarkTags A map of URL -> [tags].
 * @returns {Promise<Array>} A sorted array of matching bookmark objects.
 */
export async function customSearch(query, allBookmarks, visitCountCache, domainScores, bookmarkTags) {
    const { weights } = await chrome.storage.sync.get({
        weights: {
            titleMatch: 10, startsWithBonus: 15, tagMatch: 20, urlMatch: 3,
            allWordsBonus: 1.5, visitCount: 5, recency: 10
        }
    });

    const lowerCaseQuery = query.toLowerCase();
    
    // --- Step 1: Parse query for search terms and tag filters ---
    const allQueryWords = lowerCaseQuery.split(' ').filter(w => w);
    const tagFilters = allQueryWords.filter(w => w.startsWith('#')).map(t => t.substring(1));
    const queryWords = allQueryWords.filter(w => !w.startsWith('#'));

    // --- Step 2: Pre-filter bookmarks by tag if necessary ---
    let workingBookmarks = allBookmarks;
    if (tagFilters.length > 0) {
        workingBookmarks = allBookmarks.filter(bookmark => {
            const tags = bookmarkTags[bookmark.url] || [];
            if (tags.length === 0) return false;

            // A bookmark must have a matching tag for EVERY filter tag provided.
            return tagFilters.every(filterTag =>
                // Check if any of the bookmark's tags match the current filter tag.
                tags.some(tag => {
                    // 1. Fast check
                    if (tag.includes(filterTag)) {
                        return true;
                    }

                    // 2. Fuzzy check
                    const distance = levenshteinDistance(tag, filterTag);
                    
                    // Allow a small distance for typos. For longer tags, be more lenient.
                    const threshold = tag.length > 5 ? 2 : 1;
                    return distance <= threshold;
                })
            );
        });
    }

    // --- Pass 1: Quick text-based search and scoring ---
    const preliminaryResults = [];
    const isTagOnlySearch = queryWords.length === 0 && tagFilters.length > 0;

    for (const bookmark of workingBookmarks) {
        const lowerCaseTitle = bookmark.title.toLowerCase();
        const bookmarkUrl = bookmark.url.toLowerCase();
        const tags = bookmarkTags[bookmark.url] || [];
        let score = 0;
        const matchedWords = new Set();

        for (const word of queryWords) {
            let wordMatched = false;
            // Highest priority: Tag Match
            if (tags.some(tag => tag.includes(word))) {
                score += weights.tagMatch;
                wordMatched = true;
            }
            // Title Match
            if (lowerCaseTitle.includes(word)) {
                score += weights.titleMatch;
                if (lowerCaseTitle.split(' ').some(titleWord => titleWord.startsWith(word))) {
                    score += weights.startsWithBonus;
                }
                wordMatched = true;
            } 
            // URL Match
            else if (bookmarkUrl.includes(word)) {
                score += weights.urlMatch;
                wordMatched = true;
            }
            if (wordMatched) {
                matchedWords.add(word);
            }
        }
        
        // Levenshtein distance only if query words were used and not all matched
        if (queryWords.length > 0 && matchedWords.size < queryWords.length) {
            const distance = levenshteinDistance(queryWords.join(' '), lowerCaseTitle.substring(0, queryWords.join(' ').length));
            if (distance <= Math.floor(queryWords.join(' ').length / 4)) {
                score += 20 - distance * 5;
            }
        }

        if (isTagOnlySearch) {
            score = weights.tagMatch;
        }

        if (score > 0) {
            if (matchedWords.size === queryWords.length && queryWords.length > 1) {
                score *= weights.allWordsBonus;
            }
            try {
                const domain = new URL(bookmark.url).hostname;
                if (domainScores[domain]) {
                    score *= (1 + Math.log1p(domainScores[domain]) * 0.1);
                }
            } catch (e) { /* Invalid URL */ }
            
            preliminaryResults.push({ item: bookmark, score });
        }
    }

    // --- Pass 2: History and Recency Enrichment ---
    preliminaryResults.sort((a, b) => b.score - a.score);
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
                result.score += Math.max(0, weights.recency - daysAgo);
            }
            continue;
        }

        const historyPromise = new Promise(resolve => {
            chrome.history.getVisits({ url: url }, (visitItems) => {
                const visitCount = visitItems ? visitItems.length : 0;
                if (visitCount > 0) {
                    result.score += Math.log(visitCount + 1) * weights.visitCount;
                    const lastVisit = visitItems[0].visitTime;
                    const daysAgo = (Date.now() - lastVisit) / (1000 * 60 * 60 * 24);
                    result.score += Math.max(0, weights.recency - daysAgo);
                    visitCountCache[url] = { visitCount, lastVisit, timestamp: Date.now() };
                }
                resolve();
            });
        });
        historyPromises.push(historyPromise);
    }
    
    await Promise.all(historyPromises);

    // --- Pass 3: Deduplication based on URL, keeping the highest scored item ---
    const uniqueResults = new Map();
    for (const result of topResults) {
        const existingResult = uniqueResults.get(result.item.url);
        // If we haven't seen this URL, or the new result has a better score, keep it.
        if (!existingResult || result.score > existingResult.score) {
            uniqueResults.set(result.item.url, result);
        }
    }
    const deduplicatedResults = Array.from(uniqueResults.values());
    
    deduplicatedResults.sort((a, b) => b.score - a.score);
    return deduplicatedResults;
}