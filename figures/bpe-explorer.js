/*
  BPE explorer: a toy byte-pair-encoding tokenizer that learns its vocabulary
  in the browser from text on the page, then lets readers tokenize their own text.

  Embed in an essay:

    <figure class="fig">
      <div data-bpe-explorer
           data-corpus=".prose > p"          (CSS selector: text to learn from)
           data-text="Some default text"      (what the input starts with)
           data-examples='["strawberry","1234567"]'   (optional quick-fill buttons)
           data-max-merges="400"></div>
      <figcaption>…</figcaption>
    </figure>
    <script src="/figures/bpe-explorer.js"></script>

  Pre-tokenization follows GPT-2's rule: split into runs of letters, digits or
  punctuation, each keeping one leading space.
*/
(() => {
  const PRE = / ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+/gu;
  const SEP = '\u0000';

  function pretokenize(text) { return text.match(PRE) || []; }

  // Learn up to maxMerges merges from the corpus. Returns [[a, b], ...] in order.
  function train(corpus, maxMerges) {
    const freq = new Map();
    for (const w of pretokenize(corpus)) freq.set(w, (freq.get(w) || 0) + 1);
    const seqs = [...freq].map(([w, f]) => ({ syms: Array.from(w), f }));
    const merges = [];

    for (let m = 0; m < maxMerges; m++) {
      const counts = new Map();
      for (const { syms, f } of seqs) {
        for (let i = 0; i < syms.length - 1; i++) {
          const k = syms[i] + SEP + syms[i + 1];
          counts.set(k, (counts.get(k) || 0) + f);
        }
      }
      let best = null, bestN = 1;
      for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
      if (!best) break; // nothing occurs twice: stop
      const [a, b] = best.split(SEP);
      merges.push([a, b]);
      for (const s of seqs) s.syms = mergePair(s.syms, a, b);
    }
    return merges;
  }

  function mergePair(syms, a, b) {
    const out = [];
    for (let i = 0; i < syms.length; i++) {
      if (i < syms.length - 1 && syms[i] === a && syms[i + 1] === b) { out.push(a + b); i++; }
      else out.push(syms[i]);
    }
    return out;
  }

  // Tokenize with the first n merges: repeatedly apply the earliest-learned pair present.
  function encode(text, merges, n) {
    const rank = new Map();
    for (let i = 0; i < n; i++) rank.set(merges[i][0] + SEP + merges[i][1], i);
    const tokens = [];
    for (const word of pretokenize(text)) {
      let syms = Array.from(word);
      while (syms.length > 1) {
        let bestRank = Infinity, bestI = -1;
        for (let i = 0; i < syms.length - 1; i++) {
          const r = rank.get(syms[i] + SEP + syms[i + 1]);
          if (r !== undefined && r < bestRank) { bestRank = r; bestI = i; }
        }
        if (bestI < 0) break;
        syms = mergePair(syms, syms[bestI], syms[bestI + 1]);
      }
      tokens.push(...syms);
    }
    return tokens;
  }

  // Render a token so spaces and newlines are visible.
  function tokenNode(tok, cls) {
    const el = document.createElement('span');
    el.className = cls;
    for (const ch of tok) {
      if (ch === ' ' || ch === '\n' || ch === '\t') {
        const s = document.createElement('span');
        s.className = 'bpe-ws';
        s.textContent = ch === ' ' ? '·' : ch === '\n' ? '↵' : '→';
        el.appendChild(s);
      } else {
        el.appendChild(document.createTextNode(ch));
      }
    }
    return el;
  }

  let uid = 0;
  function mount(root) {
    const id = 'bpe' + (++uid);
    const corpus = [...document.querySelectorAll(root.dataset.corpus || 'p')]
      .map(p => p.textContent.replace(/\s+/g, ' ').trim()).join(' ');
    const merges = train(corpus, Number(root.dataset.maxMerges || 400));
    const baseVocab = new Set(Array.from(corpus)).size;
    const examples = root.dataset.examples ? JSON.parse(root.dataset.examples) : [];

    root.classList.add('bpe');
    root.innerHTML = `
      <label class="bpe-label" for="${id}-text">Type anything</label>
      <textarea id="${id}-text" class="bpe-input" rows="2" spellcheck="false"></textarea>
      <div class="bpe-examples"></div>
      <div class="bpe-out" aria-live="polite"></div>
      <div class="bpe-stats"></div>
      <label class="bpe-label" for="${id}-n">Merges learned: <output id="${id}-nout"></output></label>
      <input id="${id}-n" class="bpe-slider" type="range" min="0" max="${merges.length}" step="1">
      <div class="bpe-merges"></div>`;

    const $ = s => root.querySelector(s);
    const input = $('.bpe-input'), slider = $('.bpe-slider'), nOut = $(`#${id}-nout`);
    const out = $('.bpe-out'), stats = $('.bpe-stats'), recent = $('.bpe-merges');

    input.value = root.dataset.text || 'Tokenizers don’t see letters.';
    slider.value = merges.length;

    examples.forEach(t => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = t;
      b.addEventListener('click', () => { input.value = t; render(); });
      $('.bpe-examples').appendChild(b);
    });

    function render() {
      const n = Number(slider.value);
      const text = input.value;
      const toks = encode(text, merges, n);

      out.replaceChildren(...toks.map((t, i) => tokenNode(t, 'bpe-tok c' + (i % 5))));
      const chars = Array.from(text).length;
      stats.textContent = `${toks.length} token${toks.length === 1 ? '' : 's'} · ${chars} characters` +
        (toks.length ? ` · ${(chars / toks.length).toFixed(1)} characters per token` : '');
      nOut.textContent = `${n} of ${merges.length} (vocabulary: ${baseVocab + n})`;

      recent.replaceChildren();
      if (n > 0) {
        const head = document.createElement('div');
        head.className = 'bpe-merges-head';
        head.textContent = n === merges.length ? 'Last merges learned' : 'Most recent merges at this point';
        recent.appendChild(head);
        for (let i = n - 1; i >= Math.max(0, n - 6); i--) {
          const [a, b] = merges[i];
          const row = document.createElement('div');
          row.className = 'bpe-merge';
          const num = document.createElement('span');
          num.className = 'bpe-num';
          num.textContent = '#' + (i + 1);
          row.append(num, tokenNode(a, 'bpe-tok c0'), ' + ', tokenNode(b, 'bpe-tok c1'), ' → ', tokenNode(a + b, 'bpe-tok c2'));
          recent.appendChild(row);
        }
      }
    }

    input.addEventListener('input', render);
    slider.addEventListener('input', render);
    render();
  }

  window.BPEExplorer = { train, encode, mount };
  document.querySelectorAll('[data-bpe-explorer]').forEach(el => {
    try { mount(el); } catch (err) { console.error('BPEExplorer: could not mount figure', el, err); }
  });
})();
