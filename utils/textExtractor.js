const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const path = require('path');

/**
 * Clean up extracted text: collapse excess whitespace/blank lines,
 * fix hyphenation breaks, normalize bullets — without mangling structure.
 */
function cleanText(raw) {
    if (!raw) return '';
    return raw
        .replace(/\r\n/g, '\n')
        .replace(/\u0000/g, '')
        // join words that were hyphen-broken across a line wrap: "develop-\nment" -> "development"
        .replace(/([a-zA-Z])-\n([a-zA-Z])/g, '$1$2')
        // collapse 3+ blank lines to a max of 2
        .replace(/\n{3,}/g, '\n\n')
        // collapse runs of spaces/tabs
        .replace(/[ \t]{2,}/g, ' ')
        .split('\n')
        .map(line => line.trim())
        .join('\n')
        .trim();
}

/**
 * Heuristic: does this look like real extracted text, or garbage/empty
 * output from a scanned (image-only) PDF?
 */
function looksLikeScannedOrEmpty(text, numPages) {
    const trimmed = (text || '').trim();
    if (trimmed.length === 0) return true;
    const charsPerPage = trimmed.length / Math.max(numPages, 1);
    if (charsPerPage < 40) return true; // very little text per page -> likely scanned
    // Too many replacement/control characters is also a sign of bad extraction
    const junkRatio = (trimmed.match(/[^\x09\x0A\x0D\x20-\x7E]/g) || []).length / trimmed.length;
    if (junkRatio > 0.15) return true;
    return false;
}

/**
 * OCR fallback for scanned/image-based PDFs using pdf2pic + tesseract.js.
 * Renders each page to an image, then OCRs each image.
 */
async function ocrPdfBuffer(buffer) {
    const { fromBuffer } = require('pdf2pic');
    const Tesseract = require('tesseract.js');
    const fs = require('fs');
    const os = require('os');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-ocr-'));
    const converter = fromBuffer(buffer, {
        density: 200,
        saveFilename: 'page',
        savePath: tmpDir,
        format: 'png',
        width: 1600,
        height: 2200
    });

    let pageNum = 1;
    let combinedText = '';
    const MAX_OCR_PAGES = 6; // safety cap

    while (pageNum <= MAX_OCR_PAGES) {
        let result;
        try {
            result = await converter(pageNum, { responseType: 'image' });
        } catch (err) {
            break; // no more pages
        }
        if (!result || !result.path) break;

        try {
            const { data } = await Tesseract.recognize(result.path, 'eng');
            combinedText += '\n' + (data.text || '');
        } catch (ocrErr) {
            console.error('OCR page error:', ocrErr.message);
        } finally {
            try { fs.unlinkSync(result.path); } catch (_) {}
        }
        pageNum++;
    }

    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

    return combinedText;
}

/**
 * Main entry point: extract text from an uploaded file buffer.
 * Returns { text, method, charCount, ocrUsed }
 */
async function extractText(buffer, originalName) {
    const ext = path.extname(originalName).toLowerCase();

    if (ext === '.txt') {
        const text = cleanText(buffer.toString('utf-8'));
        return { text, method: 'TXT', charCount: text.length, ocrUsed: false };
    }

    if (ext === '.docx') {
        // mammoth.extractRawText preserves paragraph text well; convertToHtml is used
        // only as a fallback if raw text extraction comes back too short (e.g. odd docx structure)
        const { value: rawText } = await mammoth.extractRawText({ buffer });
        let text = cleanText(rawText);

        if (text.length < 40) {
            const { value: html } = await mammoth.convertToHtml({ buffer });
            const fallbackText = cleanText(html.replace(/<[^>]+>/g, '\n'));
            if (fallbackText.length > text.length) text = fallbackText;
        }
        return { text, method: 'DOCX', charCount: text.length, ocrUsed: false };
    }

    if (ext === '.pdf') {
        let parsed;
        try {
            parsed = await pdfParse(buffer);
        } catch (err) {
            parsed = { text: '', numpages: 1 };
        }
        let text = cleanText(parsed.text);
        const numPages = parsed.numpages || 1;

        if (looksLikeScannedOrEmpty(text, numPages)) {
            // Fall back to OCR for scanned / image-only PDFs
            const ocrText = cleanText(await ocrPdfBuffer(buffer));
            if (ocrText.length > text.length) {
                return { text: ocrText, method: 'PDF (OCR)', charCount: ocrText.length, ocrUsed: true };
            }
        }
        return { text, method: 'PDF', charCount: text.length, ocrUsed: false };
    }

    throw new Error('Unsupported file type. Please upload PDF, DOCX, or TXT.');
}

module.exports = { extractText, cleanText };
