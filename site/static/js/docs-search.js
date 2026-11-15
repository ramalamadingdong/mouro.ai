// Documentation search for the FIRST Agentic CSA demo on /projects/.
//
// A port of src/wpilib_mcp/utils/search.py in
// https://github.com/ramalamadingdong/agentic-csa: the same tokenizer, synonym
// expansion, typo matching (Python's difflib), BM25 scoring (rank_bm25's
// BM25Okapi) and cross-vendor merge, so a query here ranks pages the way the
// MCP server's search_frc_docs tool does. The index it searches is built from
// the server's own index files by scripts/build-docs-index.mjs.

const FRC_PRESERVED_TERMS = new Set([
    'can', 'pwm', 'i2c', 'spi', 'dio', 'usb', 'uart',
    'pid', 'ff', 'kp', 'ki', 'kd', 'kv', 'ka', 'ks',
    'neo', 'cim', 'bag', 'led', 'imu',
    'rpm', 'fps', 'mps', 'rad', 'deg',
    'frc', 'wpi', 'rev', 'ctre', 'rio',
]);

const FRC_SYNONYMS = [
    ['motor controller', ['sparkmax', 'spark max', 'talonfx', 'talon fx', 'spark flex', 'sparkflex', 'talon fxs', 'kraken']],
    ['sparkmax', ['spark max', 'motor controller', 'rev motor controller']],
    ['spark max', ['sparkmax', 'motor controller', 'rev motor controller']],
    ['talonfx', ['talon fx', 'motor controller', 'ctre motor controller', 'falcon']],
    ['talon fx', ['talonfx', 'motor controller', 'ctre motor controller', 'falcon']],
    ['falcon', ['talonfx', 'talon fx', 'falcon 500']],
    ['kraken', ['talonfx', 'talon fx', 'kraken x60']],
    ['neo', ['neo motor', 'rev neo', 'brushless motor']],
    ['neo 550', ['neo550', 'small neo']],
    ['falcon 500', ['falcon', 'talonfx integrated']],
    ['cim', ['cim motor', 'brushed motor']],
    ['cancoder', ['can coder', 'ctre encoder', 'absolute encoder']],
    ['can coder', ['cancoder', 'ctre encoder']],
    ['through bore encoder', ['rev encoder', 'throughbore']],
    ['pigeon', ['pigeon 2', 'pigeon2', 'imu', 'gyro']],
    ['navx', ['nav x', 'gyro', 'imu']],
    ['pid', ['pid controller', 'pid control', 'closed loop']],
    ['pid controller', ['pid', 'closed loop control']],
    ['feedforward', ['ff', 'feed forward', 'kv ka']],
    ['motion magic', ['motion profiling', 's-curve', 'trapezoidal']],
    ['motion profile', ['motion magic', 'trajectory', 'path following']],
    ['command based', ['command-based', 'commands', 'subsystems']],
    ['command-based', ['command based', 'commands', 'subsystems']],
    ['timed robot', ['timedrobot', 'iterative robot']],
    ['subsystem', ['subsystems', 'command based']],
    ['can bus', ['canbus', 'can network', 'can wiring']],
    ['canbus', ['can bus', 'can network']],
];
const SYNONYM_MAP = new Map(FRC_SYNONYMS);

const STOP_WORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'shall', 'need',
    'this', 'that', 'these', 'those', 'it', 'its', 'you', 'your', 'we',
    'our', 'they', 'their', 'he', 'she', 'him', 'her', 'his', 'hers',
    'how', 'what', 'when', 'where', 'why', 'which', 'who',
]);

const PROTECTED = ['CANcoder', 'CANbus', 'TalonFX', 'SparkMax', 'SparkFlex', 'NavX', 'REVLib', 'WPILib', 'NetworkTables'];

/** Split text into search tokens: camelCase and snake_case aware, FRC terms kept. */
export function tokenize(text) {
    let s = text;
    for (const term of PROTECTED) s = s.split(term).join(term.toLowerCase());
    s = s.replace(/([a-z])([A-Z])/g, '$1 $2');
    s = s.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
    s = s.toLowerCase();
    s = s.replace(/[_\-]/g, ' ');
    s = s.replace(/[^\p{L}\p{N}\s]/gu, ' ');
    const out = [];
    for (const t of s.split(/\s+/)) {
        if (t.length > 1 && (FRC_PRESERVED_TERMS.has(t) || !STOP_WORDS.has(t))) out.push(t);
    }
    return out;
}

function expandQuery(tokens) {
    const expanded = [...tokens];
    const add = (syn) => {
        for (const st of syn.toLowerCase().split(/\s+/)) {
            if (st && !expanded.includes(st) && !STOP_WORDS.has(st)) expanded.push(st);
        }
    };
    const queryText = tokens.join(' ');
    for (const [phrase, synonyms] of FRC_SYNONYMS) {
        if (queryText.includes(phrase)) synonyms.slice(0, 2).forEach(add);
    }
    for (const token of tokens) {
        const synonyms = SYNONYM_MAP.get(token);
        if (synonyms) synonyms.slice(0, 2).forEach(add);
    }
    return expanded;
}

// ── difflib.SequenceMatcher.ratio / get_close_matches ───────────────────────

function matchedLength(a, b) {
    const b2j = new Map();
    for (let j = 0; j < b.length; j++) {
        const list = b2j.get(b[j]);
        if (list) list.push(j);
        else b2j.set(b[j], [j]);
    }
    let total = 0;
    const queue = [[0, a.length, 0, b.length]];
    while (queue.length) {
        const [alo, ahi, blo, bhi] = queue.pop();
        let besti = alo;
        let bestj = blo;
        let bestsize = 0;
        let j2len = new Map();
        for (let i = alo; i < ahi; i++) {
            const next = new Map();
            const js = b2j.get(a[i]);
            if (js) {
                for (const j of js) {
                    if (j < blo) continue;
                    if (j >= bhi) break;
                    const k = (j2len.get(j - 1) ?? 0) + 1;
                    next.set(j, k);
                    if (k > bestsize) {
                        besti = i - k + 1;
                        bestj = j - k + 1;
                        bestsize = k;
                    }
                }
            }
            j2len = next;
        }
        if (bestsize) {
            total += bestsize;
            if (alo < besti && blo < bestj) queue.push([alo, besti, blo, bestj]);
            if (besti + bestsize < ahi && bestj + bestsize < bhi) queue.push([besti + bestsize, ahi, bestj + bestsize, bhi]);
        }
    }
    return total;
}

function quickMatches(a, bCounts) {
    const avail = new Map();
    let matches = 0;
    for (const ch of a) {
        const n = avail.has(ch) ? avail.get(ch) : (bCounts.get(ch) ?? 0);
        avail.set(ch, n - 1);
        if (n > 0) matches++;
    }
    return matches;
}

/** The closest other word in `vocabulary`, as difflib.get_close_matches(...)[0] would pick. */
function closestOther(word, vocabulary, cutoff) {
    if (word.length < 3) return null;
    const wordChars = [...word];
    const counts = new Map();
    for (const ch of wordChars) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    const found = [];
    for (const cand of vocabulary) {
        const candChars = [...cand];
        const len = candChars.length + wordChars.length;
        if ((2.0 * Math.min(candChars.length, wordChars.length)) / len < cutoff) continue;
        if ((2.0 * quickMatches(candChars, counts)) / len < cutoff) continue;
        const ratio = (2.0 * matchedLength(candChars, wordChars)) / len;
        if (ratio >= cutoff) found.push([ratio, cand]);
    }
    found.sort((p, q) => q[0] - p[0] || (p[1] < q[1] ? 1 : p[1] > q[1] ? -1 : 0));
    for (const [, cand] of found.slice(0, 3)) {
        if (cand !== word) return cand;
    }
    return null;
}

// ── BM25Okapi ───────────────────────────────────────────────────────────────

const K1 = 1.5;
const B = 0.75;
const EPSILON = 0.25;

class VendorIndex {
    constructor(data) {
        this.id = data.id;
        this.name = data.name;
        this.docs = data.docs; // [url, title, section, preview, length]
        this.terms = data.terms; // term → [doc, tf, doc, tf, …]
        this.vocabulary = Object.keys(data.terms);
        const n = this.docs.length;
        let total = 0;
        for (const d of this.docs) total += d[4];
        this.avgdl = total / n;

        this.idf = new Map();
        let idfSum = 0;
        const negative = [];
        for (const term of this.vocabulary) {
            const freq = this.terms[term].length / 2;
            const idf = Math.log(n - freq + 0.5) - Math.log(freq + 0.5);
            this.idf.set(term, idf);
            idfSum += idf;
            if (idf < 0) negative.push(term);
        }
        const eps = EPSILON * (idfSum / this.vocabulary.length);
        for (const term of negative) this.idf.set(term, eps);
    }

    search(query, maxResults) {
        const queryTokens = tokenize(query);
        if (!queryTokens.length) return [];
        const searchTokens = expandQuery(queryTokens);
        for (const token of queryTokens) {
            const match = closestOther(token, this.vocabulary, 0.8);
            if (match && !searchTokens.includes(match)) searchTokens.push(match);
        }

        const scores = new Float64Array(this.docs.length);
        for (const token of searchTokens) {
            if (!Object.hasOwn(this.terms, token)) continue;
            const postings = this.terms[token];
            const idf = this.idf.get(token);
            for (let p = 0; p < postings.length; p += 2) {
                const doc = postings[p];
                const tf = postings[p + 1];
                scores[doc] += idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * this.docs[doc][4]) / this.avgdl)));
            }
        }

        const results = [];
        for (let i = 0; i < scores.length; i++) {
            if (scores[i] > 0) results.push({ doc: i, score: scores[i] });
        }
        results.sort((p, q) => q.score - p.score || p.doc - q.doc);
        return results.slice(0, maxResults).map(({ doc, score }) => {
            const [url, title, section, preview] = this.docs[doc];
            return { url, title, section, preview, vendor: this.name, vendorId: this.id, score };
        });
    }
}

export class DocsSearch {
    constructor(index) {
        this.builtAt = index.builtAt;
        this.vendors = index.vendors.map((v) => new VendorIndex(v));
        this.pageCount = this.vendors.reduce((n, v) => n + v.docs.length, 0);
    }

    /**
     * Search one vendor, or all of them. Across vendors each source's scores
     * are scaled to its own best hit before merging, as the server does.
     */
    search(query, { vendor = 'all', maxResults = 10 } = {}) {
        const merged = [];
        for (const v of this.vendors) {
            if (vendor !== 'all' && v.id !== vendor) continue;
            const results = v.search(query, maxResults);
            if (!results.length) continue;
            const top = results[0].score || 1;
            for (const r of results) merged.push({ ...r, score: r.score / top });
        }
        return merged
            .map((r, i) => [r, i])
            .sort((p, q) => q[0].score - p[0].score || p[1] - q[1])
            .slice(0, maxResults)
            .map(([r]) => r);
    }
}
