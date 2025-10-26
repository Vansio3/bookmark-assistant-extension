/**
 * Calculates the Levenshtein distance between two strings.
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
 * Performs a fast search on pre-processed bookmarks with cached history scores.
 */
export async function customSearch(query, allBookmarks, domainScores, bookmarkTags) {
    const { weights } = await chrome.storage.sync.get({
        weights: {
            titleMatch: 10, startsWithBonus: 15, tagMatch: 20, urlMatch: 3, pathMatch: 5,
            allWordsBonus: 1.5, visitCount: 5, recency: 10
        }
    });

    const lowerCaseQuery = query.toLowerCase();
    const allQueryWords = lowerCaseQuery.split(' ').filter(w => w);
    const tagFilters = allQueryWords.filter(w => w.startsWith('#')).map(t => t.substring(1));
    const queryWords = allQueryWords.filter(w => !w.startsWith('#'));

    let workingBookmarks = allBookmarks;
    if (tagFilters.length > 0) {
        workingBookmarks = allBookmarks.filter(bookmark => {
            const tags = bookmarkTags[bookmark.url] || [];
            if (tags.length === 0) return false;
            return tagFilters.every(filterTag =>
                tags.some(tag => {
                    if (tag.includes(filterTag)) return true;
                    const distance = levenshteinDistance(tag, filterTag);
                    const threshold = tag.length > 5 ? 2 : 1;
                    return distance <= threshold;
                })
            );
        });
    }

    const results = [];
    const isTagOnlySearch = queryWords.length === 0 && tagFilters.length > 0;

    for (const bookmark of workingBookmarks) {
        const lowerCaseTitle = bookmark.title.toLowerCase();
        const bookmarkUrl = bookmark.url.toLowerCase();
        const lowerCasePath = (bookmark.path || '').toLowerCase();
        const tags = bookmarkTags[bookmark.url] || [];
        let score = 0;
        const matchedWords = new Set();

        if (isTagOnlySearch) {
            score = weights.tagMatch;
        } else {
            for (const word of queryWords) {
                let wordMatched = false;
                if (tags.some(tag => tag.includes(word))) {
                    score += weights.tagMatch;
                    wordMatched = true;
                }
                if (lowerCaseTitle.includes(word)) {
                    score += weights.titleMatch;
                    if (lowerCaseTitle.split(' ').some(titleWord => titleWord.startsWith(word))) {
                        score += weights.startsWithBonus;
                    }
                    wordMatched = true;
                }
                else if (bookmarkUrl.includes(word)) {
                    score += weights.urlMatch;
                    wordMatched = true;
                }
                else if (lowerCasePath.includes(word)) {
                    score += weights.pathMatch;
                    wordMatched = true;
                }
                if (wordMatched) {
                    matchedWords.add(word);
                }
            }
        }
        
        if (score > 0) {
            // Levenshtein check
            if (queryWords.length > 0 && matchedWords.size < queryWords.length) {
                const distance = levenshteinDistance(queryWords.join(' '), lowerCaseTitle.substring(0, queryWords.join(' ').length));
                if (distance <= Math.floor(queryWords.join(' ').length / 4)) {
                    score += 20 - distance * 5;
                }
            }
            
            // All words matched bonus
            if (matchedWords.size === queryWords.length && queryWords.length > 1) {
                score *= weights.allWordsBonus;
            }

            // Domain preference bonus
            try {
                const domain = new URL(bookmark.url).hostname;
                if (domainScores[domain]) {
                    score *= (1 + Math.log1p(domainScores[domain]) * 0.1);
                }
            } catch (e) { /* Invalid URL */ }
            
            // Pre-calculated history bonus
            if (bookmark.visitCount > 0) {
                score += Math.log(bookmark.visitCount + 1) * weights.visitCount;
            }
            if (bookmark.lastVisitTime > 0) {
                const daysAgo = (Date.now() - bookmark.lastVisitTime) / (1000 * 60 * 60 * 24);
                score += Math.max(0, weights.recency - daysAgo);
            }

            results.push({ item: bookmark, score });
        }
    }
    
    // Sort and return the top results
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 50); // Slice at the very end
}