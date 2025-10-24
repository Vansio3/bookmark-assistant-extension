// --- Default Settings ---
const DEFAULT_WEIGHTS = {
    titleMatch: 10,
    startsWithBonus: 15,
    tagMatch: 20,
    urlMatch: 3,
    allWordsBonus: 1.5,
    visitCount: 5,
    recency: 10
};

/**
 * Displays a status message to the user for a short duration.
 */
function showStatus(message) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.classList.add('visible');
    setTimeout(() => {
        status.classList.remove('visible');
    }, 2000);
}

/**
 * Saves options to chrome.storage.sync.
 */
function saveOptions() {
    chrome.storage.sync.set({
        weights: {
            titleMatch: parseFloat(document.getElementById('titleMatch').value),
            startsWithBonus: parseFloat(document.getElementById('startsWithBonus').value),
            tagMatch: parseFloat(document.getElementById('tagMatch').value), // Save new value
            urlMatch: parseFloat(document.getElementById('urlMatch').value),
            allWordsBonus: parseFloat(document.getElementById('allWordsBonus').value),
            visitCount: parseFloat(document.getElementById('visitCount').value),
            recency: parseFloat(document.getElementById('recency').value)
        }
    }, () => showStatus('Options saved.'));
}

/**
 * Populates the form with the given weights object.
 */
function setFormValues(weights) {
    document.getElementById('titleMatch').value = weights.titleMatch;
    document.getElementById('startsWithBonus').value = weights.startsWithBonus;
    document.getElementById('tagMatch').value = weights.tagMatch; // Set new value
    document.getElementById('urlMatch').value = weights.urlMatch;
    document.getElementById('allWordsBonus').value = weights.allWordsBonus;
    document.getElementById('visitCount').value = weights.visitCount;
    document.getElementById('recency').value = weights.recency;
}

/**
 * Restores options from chrome.storage.sync.
 */
function restoreOptions() {
    chrome.storage.sync.get({ weights: DEFAULT_WEIGHTS }, (items) => {
        setFormValues(items.weights);
    });
}

/**
 * Resets all scoring weights to their default values.
 */
function resetOptions() {
    if (confirm("Are you sure you want to reset all scoring weights to their default values?")) {
        // We can just remove the setting; the extension will use the defaults next time.
        chrome.storage.sync.remove('weights', () => {
            setFormValues(DEFAULT_WEIGHTS);
            showStatus('Weights have been reset to default.');
        });
    }
}

/**
 * Clears the stored domain preference data.
 */
function clearDomainData() {
    if (confirm("Are you sure you want to clear the domain visit history? This will reset the algorithm's learning of your preferred sites.")) {
        chrome.storage.local.remove('domainScores', () => {
            showStatus('Domain data has been cleared.');
        });
    }
}

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('save').addEventListener('click', saveOptions);
document.getElementById('reset').addEventListener('click', resetOptions);
document.getElementById('clearDomains').addEventListener('click', clearDomainData);