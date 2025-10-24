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
 * Performs an advanced fuzzy search on a bookmarks list with a sophisticated scoring system.
 * It now searches both title and URL with different weights.
 * @param {string} query The search query.
 * @param {Array} allBookmarks The list of all bookmarks to search through.
 * @returns {Array} A sorted array of matching bookmark objects.
 */
export function customSearch(query, allBookmarks) {
    const lowerCaseQuery = query.toLowerCase();
    const queryWords = lowerCaseQuery.split(' ').filter(w => w);
    const results = [];

    for (const bookmark of allBookmarks) {
        const lowerCaseTitle = bookmark.title.toLowerCase();
        const lowerCaseUrl = bookmark.url.toLowerCase(); // NEW: Get the URL for searching
        let score = 0;
        const matchedWords = new Set(); // Keep track of unique words found

        // 1. Check for matches for each word in the query
        for (const word of queryWords) {
            const inTitle = lowerCaseTitle.includes(word);
            const inUrl = lowerCaseUrl.includes(word);

            if (inTitle) {
                score += 10; // High base score for title inclusion
                // Boost score if it's a "starts with" match in the title
                if (lowerCaseTitle.split(' ').some(titleWord => titleWord.startsWith(word))) {
                    score += 15;
                }
                matchedWords.add(word);
            } else if (inUrl) {
                score += 3; // Low base score for URL inclusion
                matchedWords.add(word);
            }
        }

        // 2. If not all words were found, try fuzzy matching on the title
        if (matchedWords.size < queryWords.length) {
            const distance = levenshteinDistance(lowerCaseQuery, lowerCaseTitle.substring(0, lowerCaseQuery.length));
            // Allow for typos (e.g., 1 typo for every 4 characters)
            if (distance <= Math.floor(lowerCaseQuery.length / 4)) {
                score += 20 - distance * 5; // Higher score for closer matches
            }
        }

        // 3. Bonus for shorter titles (more specific matches)
        if (score > 0) {
            score += 5 / lowerCaseTitle.length;
        }

        // 4. Bonus for matching all query words (whether in title or URL)
        if (matchedWords.size === queryWords.length && queryWords.length > 1) {
            score *= 1.5; // Significant boost
        }

        if (score > 0) {
            results.push({ item: bookmark, score: score });
        }
    }

    // Sort results by score in descending order
    results.sort((a, b) => b.score - a.score);

    // Limit to a reasonable number of results to keep the UI clean
    return results.slice(0, 50);
}