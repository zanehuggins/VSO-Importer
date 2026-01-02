// app.js — CSV → JSON Converter (VSO Schema)

const fileInput = document.getElementById('csvFile');
const parseBtn = document.getElementById('parseBtn');
const resetBtn = document.getElementById('resetBtn');
const output = document.getElementById('jsonOutput');
const statusEl = document.getElementById('status');
const schemaSelect = document.getElementById('schemaSelect');
const batchSizeInput = document.getElementById('batchSize');
const copyBtn = document.getElementById('copyBtn');
const downloadBtn = document.getElementById('downloadBtn');
const openaiKeyInput = document.getElementById('openaiKey');
const runEnrichmentBtn = document.getElementById('runEnrichmentBtn');
const aiStatusEl = document.getElementById('aiStatus');
const forceOverviewCheckbox = document.getElementById('forceOverview');

let parsedData = [];

/**
 * VSO SCHEMA — mirrors the WordPress VSO Importer exactly
 * Field order is deterministic and intentional
 */
const VSO_SCHEMA = [
  'post_title',
  'organization',
  'address',
  'address_verified',
  'city',
  'state',
  'country',
  'phone',
  'email',
  'website',
  'zip_code',
  'district',
  'service',
  'overview',
  'low_confidence'
];

/**
 * CSV HEADER → VSO FIELD MAP
 * Left side = exact CSV column header
 * Right side = VSO schema field
 */
const CSV_TO_VSO_MAP = {
  'Name': 'post_title',
  'VSO Organization': 'organization',
  'Address': 'address',
  'City': 'city',
  'State': 'state',
  'Phone Number': 'phone',
  'District': 'district'
};

/**
 * UI helpers
 */
const setStatus = (msg, isError = false) => {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', isError);
};

/**
 * Utility helpers
 */
const chunkArray = (arr, size) => {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
};

const normalizeValue = (val) => {
  if (val === undefined || val === null) return '';
  const trimmed = String(val).trim();
  if (trimmed.toLowerCase() === 'nan') return '';
  return trimmed;
};

const extractZipFromAddress = (address) => {
  if (!address) return '';
  const match = address.match(/\b\d{5}(?:-\d{4})?\b/);
  return match ? match[0] : '';
};

/**
 * Enforce VSO schema strictly
 * Maps CSV headers → VSO schema fields
 * Missing fields are intentionally left blank
 */
const normalizeVSORow = (row) => {
  // If already normalized, return as-is
  if (row.post_title !== undefined) {
    return row;
  }

  const obj = {};

  // Initialize all schema fields with defaults
  VSO_SCHEMA.forEach((key) => {
    if (key === 'low_confidence') {
      obj[key] = false;
    } else if (key === 'address_verified') {
      obj[key] = false; // CSV addresses are unverified by default
    } else {
      obj[key] = '';
    }
  });

  // Map CSV columns into schema fields
  Object.entries(CSV_TO_VSO_MAP).forEach(([csvHeader, schemaKey]) => {
    if (row[csvHeader] !== undefined) {
      obj[schemaKey] = normalizeValue(row[csvHeader]);
    }
  });

  // Extract ZIP from CSV address if present
  if (obj.address && !obj.zip_code) {
    const zip = extractZipFromAddress(obj.address);
    if (zip) {
      obj.zip_code = zip;
    }
  }

  return obj;
};

/**
 * CSV parse handler
 */
parseBtn.addEventListener('click', () => {
  const file = fileInput.files[0];
  if (!file) {
    setStatus('Please select a CSV file.', true);
    return;
  }

  setStatus('Parsing CSV…');

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      if (!results.data || !results.data.length) {
        setStatus('No data rows found in CSV.', true);
        return;
      }

      // Always normalize to VSO schema for output
      schemaSelect.value = 'vso'; // Lock schema to VSO
      const batchSize = parseInt(batchSizeInput.value, 10) || 10;
      parsedData = results.data.map(normalizeVSORow);
      // Output flat array (no batch wrapper)
      output.value = JSON.stringify(parsedData, null, 2);
      setStatus(
        `Parsed ${parsedData.length} records into ${Math.ceil(parsedData.length / batchSize)} batch(es).`
      );
    },
    error: (err) => {
      setStatus(`CSV parsing error: ${err.message}`, true);
    }
  });
});

/**
 * Reset UI
 */
resetBtn.addEventListener('click', () => {
  fileInput.value = '';
  output.value = '';
  parsedData = [];
  setStatus('');
});

/**
 * Copy JSON to clipboard
 */
if (copyBtn && output) {
  copyBtn.addEventListener('click', async () => {
    if (!output.value) {
      setStatus('Nothing to copy.', true);
      return;
    }

    try {
      await navigator.clipboard.writeText(output.value);
      const originalText = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setStatus('JSON copied to clipboard.');
      setTimeout(() => {
        copyBtn.textContent = originalText || 'Copy JSON';
      }, 1200);
    } catch (err) {
      console.error('Clipboard copy failed:', err);
      setStatus('Failed to copy JSON.', true);
    }
  });
}

/**
 * Download JSON file
 */
downloadBtn.addEventListener('click', () => {
  if (!output.value) return;

  const blob = new Blob([output.value], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = 'vso-import.json';
  a.click();

  URL.revokeObjectURL(url);
  setStatus('JSON file downloaded.');
});



// Load saved OpenAI API key on startup (local only)
const savedKey = localStorage.getItem('openai_api_key');
if (savedKey && openaiKeyInput) {
  openaiKeyInput.value = savedKey;
}

// Persist API key locally when updated
if (openaiKeyInput) {
  openaiKeyInput.addEventListener('change', () => {
    const key = openaiKeyInput.value.trim();
    if (key.startsWith('sk-')) {
      localStorage.setItem('openai_api_key', key);
    }
  });
}

/**
 * Run AI Enrichment — Single OpenAI Call Per Row
 */
if (runEnrichmentBtn) {
  runEnrichmentBtn.addEventListener('click', async () => {
if (!parsedData.length) {
  aiStatusEl.textContent = 'Parse a CSV before running AI enrichment.';
  aiStatusEl.classList.add('error');
  return;
}
// Ensure data is normalized to VSO schema before enrichment
if (schemaSelect.value !== 'vso') {
  parsedData = parsedData.map(normalizeVSORow);
}

    const apiKey = openaiKeyInput?.value?.trim();
    if (!apiKey) {
      aiStatusEl.textContent = 'OpenAI API key is required.';
      aiStatusEl.classList.add('error');
      return;
    }

    aiStatusEl.classList.remove('error');
    aiStatusEl.textContent = 'Running AI enrichment…';

    let updated = 0;

    for (const row of parsedData) {
      const skipReasons = [];
      let didUpdate = false;

      // Skip rows already fully enriched
      if (
        row.address_verified &&
        row.website &&
        row.overview &&
        row.email
      ) {
        continue;
      }

      if (!row.post_title || !row.state) {
        row.low_confidence = true;
        skipReasons.push('missing post_title or state');
        console.warn('Skipping row:', row.post_title, skipReasons);
        continue;
      }

      try {
        const prompt = `
You are enriching structured directory data for a Veterans Service Organization.

Organization:
Name: ${row.post_title}
Organization Type: ${row.organization || ''}
State: ${row.state}

Instructions:
- Prefer accuracy over completeness
- Do NOT invent specific facts
- You may provide general descriptions for overviews if exact details are unavailable
- Do NOT overwrite existing values
- Address must be Google Maps formatted: Street, City, ST ZIP
- Website must be the official site (not social media unless primary)
- Email must be a public, official contact email
- Overview must be a short, factual paragraph

If uncertain about any field, return it as an empty string.

Return JSON only in this exact shape:
{
  "address": "",
  "address_confidence": "high | low",
  "website": "",
  "email": "",
  "overview": "",
  "overall_confidence": "high | low"
}
        `.trim();

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0
          })
        });

        const result = await response.json();
        const content = result?.choices?.[0]?.message?.content;

        if (!content) {
          row.low_confidence = true;
          skipReasons.push('empty AI response');
          console.warn('Skipping row:', row.post_title, skipReasons);
          continue;
        }

        let enriched;
        try {
          const cleaned = content
            .replace(/```json/gi, '')
            .replace(/```/g, '')
            .trim();
          enriched = JSON.parse(cleaned);
        } catch (err) {
          row.low_confidence = true;
          skipReasons.push('invalid JSON from AI');
          console.warn('Skipping row:', row.post_title, skipReasons);
          continue;
        }

        // Address (AI-provided)
        if (enriched.address) {
          row.address = enriched.address;

          if (enriched.address_confidence === 'high') {
            row.address_verified = true;
          }

          // Always extract ZIP from address if missing
          if (!row.zip_code) {
            const zip = extractZipFromAddress(enriched.address);
            if (zip) {
              row.zip_code = zip;
            }
          }

          didUpdate = true;
        }

        // Website (only if blank)
        if (!row.website && enriched.website) {
          row.website = enriched.website;
          didUpdate = true;
        }

        // Email (only if blank)
        if (!row.email && enriched.email) {
          row.email = enriched.email;
          didUpdate = true;
        }

        // Overview (forceable)
        if (!row.overview && enriched.overview) {
          if (
            enriched.overall_confidence === 'high' ||
            forceOverviewCheckbox?.checked
          ) {
            row.overview = enriched.overview;
            didUpdate = true;
          }
        }

        if (enriched.overall_confidence !== 'high') {
          row.low_confidence = true;
        }

        // Only increment updated if at least one field changed
        if (!didUpdate) {
          row.low_confidence = true;
          console.warn(
            'AI returned no usable enrichment for:',
            row.post_title
          );
          continue;
        }
        updated++;
      } catch (err) {
        console.error('AI enrichment error:', err);
        row.low_confidence = true;
      }
    }

    // Re-render output — FORCE VSO SCHEMA NORMALIZATION
    const batchSize = parseInt(batchSizeInput.value, 10) || 10;
    // Output flat array (no batch wrapper)
    output.value = JSON.stringify(parsedData, null, 2);

    aiStatusEl.textContent =
      `AI enrichment complete. ${updated} row(s) processed. ` +
      `See console for skipped-row details.`;
  });
}