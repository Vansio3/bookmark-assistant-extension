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
 * @param {string} message The message to display.
 * @param {boolean} isError If true, the message will be styled as an error.
 */
function showStatus(message, isError = false) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.style.color = isError ? '#ff6b6b' : 'var(--primary-accent)';
    status.classList.add('visible');
    setTimeout(() => {
        status.classList.remove('visible');
    }, 3000);
}

/**
 * Saves options to chrome.storage.sync.
 */
function saveOptions() {
    chrome.storage.sync.set({
        weights: {
            titleMatch: parseFloat(document.getElementById('titleMatch').value),
            startsWithBonus: parseFloat(document.getElementById('startsWithBonus').value),
            tagMatch: parseFloat(document.getElementById('tagMatch').value),
            urlMatch: parseFloat(document.getElementById('urlMatch').value),
            allWordsBonus: parseFloat(document.getElementById('allWordsBonus').value),
            visitCount: parseFloat(document.getElementById('visitCount').value),
            recency: parseFloat(document.getElementById('recency').value)
        }
    }, () => showStatus('Options saved.'));
}

/**
 * Populates the form with the given weights object.
 * @param {object} weights The weights object to load into the form.
 */
function setFormValues(weights) {
    document.getElementById('titleMatch').value = weights.titleMatch;
    document.getElementById('startsWithBonus').value = weights.startsWithBonus;
    document.getElementById('tagMatch').value = weights.tagMatch;
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
        // Ensure that any newly added default weights are included if they're not in storage.
        const mergedWeights = { ...DEFAULT_WEIGHTS, ...items.weights };
        setFormValues(mergedWeights);
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

/**
 * Validates the structure and types of the imported data object.
 * @param {object} data The parsed JSON data from an imported file.
 * @returns {boolean} True if the data is valid, false otherwise.
 */
function validateImportedData(data) {
    if (typeof data !== 'object' || data === null) return false;
    if (typeof data.weights !== 'object' || data.weights === null) return false;

    // Check if all required weight keys exist and are numbers
    for (const key of Object.keys(DEFAULT_WEIGHTS)) {
        if (typeof data.weights[key] !== 'number') {
            return false;
        }
    }

    if (typeof data.domainScores !== 'object' || data.domainScores === null) return false;
    if (typeof data.bookmarkTags !== 'object' || data.bookmarkTags === null) return false;

    return true;
}

/**
 * Gathers all user settings and data and triggers a download of a JSON file.
 */
async function exportData() {
    try {
        const syncData = await chrome.storage.sync.get('weights');
        const localData = await chrome.storage.local.get(['domainScores', 'bookmarkTags']);

        const exportObject = {
            weights: syncData.weights || DEFAULT_WEIGHTS,
            domainScores: localData.domainScores || {},
            bookmarkTags: localData.bookmarkTags || {}
        };

        const blob = new Blob([JSON.stringify(exportObject, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const dateStamp = new Date().toISOString().slice(0, 10);
        a.download = `bookmark-assistant-backup-${dateStamp}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showStatus('Data exported successfully.');
    } catch (error) {
        console.error('Export failed:', error);
        showStatus('Error exporting data.', true);
    }
}

/**
 * Handles the file selection event for importing data, validates, and saves it.
 * @param {Event} event The file input change event.
 */
function handleFileImport(event) {
    const file = event.target.files[0];
    if (!file) {
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (!validateImportedData(data)) {
                throw new Error("Invalid or corrupted backup file.");
            }

            // If validation passes, save the data
            await chrome.storage.sync.set({ weights: data.weights });
            await chrome.storage.local.set({
                domainScores: data.domainScores,
                bookmarkTags: data.bookmarkTags
            });

            // Update the form on the page to reflect the imported settings
            setFormValues(data.weights);
            showStatus('Data imported successfully!');

        } catch (error) {
            console.error('Import failed:', error);
            showStatus(error.message || 'Failed to parse the file.', true);
        } finally {
            // Reset the file input so the same file can be selected again if needed
            event.target.value = '';
        }
    };
    reader.readAsText(file);
}

// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('save').addEventListener('click', saveOptions);
document.getElementById('reset').addEventListener('click', resetOptions);
document.getElementById('clearDomains').addEventListener('click', clearDomainData);
document.getElementById('exportData').addEventListener('click', exportData);

// The "Import" button acts as a proxy to click the hidden file input
document.getElementById('importDataBtn').addEventListener('click', () => {
    document.getElementById('importData').click();
});

// The actual file input that handles the logic
document.getElementById('importData').addEventListener('change', handleFileImport);