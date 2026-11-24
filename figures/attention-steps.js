/*
  Attention steps: walks one word's attention through scores, scaling,
  masking and softmax, computing each step in the browser from real scores.

  Embed in an essay:

    <figure class="fig">
      <div data-attention-steps data-start="7" data-dk="64">
        <script type="application/json">
          {"tokens": ["The", ...], "scores": [[...], ...]}
        </script>
      </div>
      <figcaption>…</figcaption>
    </figure>
    <script src="/figures/attention-steps.js"></script>

  scores[i][j] = query i · key j / sqrt(dk), before the mask.
*/
(() => {
  const STEPS = [
    { name: 'Score', note: 'The dot product of this word’s query with every word’s key. Higher means a better match.' },
    { name: 'Scale', note: 'Every score divided by 8, the square root of 64. The order is unchanged; the gaps are smaller.' },
    { name: 'Mask', note: 'Words that come later are ruled out.' },
    { name: 'Softmax', note: 'The remaining scores become weights that add up to 100%.' },
  ];

  function softmax(row, upTo) {
    const open = row.slice(0, upTo + 1);
    const max = Math.max(...open);
    const exps = open.map(v => Math.exp(v - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return row.map((_, j) => (j <= upTo ? exps[j] / sum : 0));
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function buttons(labels, cls, group, onPick) {
    const wrap = el('div', cls);
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', group);
    const btns = labels.map((label, i) => {
      const b = el('button', '', label);
      b.type = 'button';
      b.addEventListener('click', () => onPick(i));
      wrap.appendChild(b);
      return b;
    });
    return { wrap, mark: n => btns.forEach((b, i) => b.setAttribute('aria-pressed', String(i === n))) };
  }

  function mount(root) {
    const { tokens, scores } = JSON.parse(root.querySelector('script[type="application/json"]').textContent);
    const rootDk = Math.sqrt(Number(root.dataset.dk || 64));
    let word = Number(root.dataset.start || 0), step = 0;

    root.classList.add('steps');
    const words = buttons(tokens, 'steps-words', 'Word doing the looking', i => { word = i; render(); });
    const stages = buttons(STEPS.map((s, i) => `${i + 1}. ${s.name}`), 'steps-stages', 'Step', i => { step = i; render(); });
    const note = el('p', 'steps-note');
    note.setAttribute('aria-live', 'polite');
    const rows = el('div', 'steps-rows');
    root.replaceChildren(el('div', 'steps-label', 'Word doing the looking'), words.wrap,
      el('div', 'steps-label', 'Step'), stages.wrap, note, rows);

    function render() {
      words.mark(word);
      stages.mark(step);
      note.textContent = STEPS[step].note;
      const scaled = scores[word];
      const values = step === 0 ? scaled.map(v => v * rootDk) : step === 3 ? softmax(scaled, word) : scaled;
      const lo = Math.min(...values), hi = Math.max(...values);

      rows.replaceChildren(...tokens.map((t, j) => {
        const hidden = step >= 2 && j > word;
        const v = values[j];
        const width = hidden ? 0 : step === 3 ? v * 100 : hi === lo ? 100 : 4 + 96 * (v - lo) / (hi - lo);
        const row = el('div', 'steps-row' + (hidden ? ' is-masked' : '') + (j === word ? ' is-self' : ''));
        const track = el('span', 'steps-track');
        const bar = el('span', 'steps-bar');
        bar.style.width = width.toFixed(1) + '%';
        track.appendChild(bar);
        const text = hidden ? 'hidden' : step === 3 ? (v * 100).toFixed(1) + '%'
          : v.toFixed(step === 0 ? 1 : 2).replace('-', '−');
        row.append(el('span', 'steps-word', t), track, el('span', 'steps-num', text));
        return row;
      }));
    }
    render();
  }

  window.AttentionSteps = { mount, softmax };
  document.querySelectorAll('[data-attention-steps]').forEach(root => {
    try { mount(root); } catch (err) { console.error('AttentionSteps: could not mount figure', root, err); }
  });
})();
