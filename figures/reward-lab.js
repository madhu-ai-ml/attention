/*
  Reward lab: the reader picks between pairs of answers, a tiny reward model
  (logistic regression on a few labeled traits) learns from the picks, then
  scores new answers. It never sees which answers are true.

  Embed in an essay:

    <figure class="fig">
      <div data-reward-lab>
        <script type="application/json">
          {"traits": ["Long", ...],
           "pairs": [{"q": "…", "a": [{"text": "…", "f": [0, 1]}, {"text": "…", "f": [1, 0]}]}],
           "test": {"q": "…", "answers": [{"text": "…", "f": [0, 1], "right": true}]}}
        </script>
      </div>
      <figcaption>…</figcaption>
    </figure>
    <script src="/figures/reward-lab.js"></script>
*/
(() => {
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  const dot = (w, f) => w.reduce((s, v, i) => s + v * f[i], 0);

  // diffs: chosen traits minus rejected traits. Small penalty keeps weights finite.
  function fit(diffs, n) {
    const w = new Array(n).fill(0);
    for (let step = 0; step < 4000; step++) {
      const g = w.map(v => -0.3 * v);
      for (const d of diffs) {
        const miss = 1 / (1 + Math.exp(dot(w, d)));
        d.forEach((v, i) => { g[i] += miss * v; });
      }
      g.forEach((v, i) => { w[i] += 0.05 * v; });
    }
    return w;
  }
  const signed = v => (v < -0.005 ? '−' : v > 0.005 ? '+' : '') + Math.abs(v).toFixed(2);

  function mount(root) {
    const data = JSON.parse(root.querySelector('script[type="application/json"]').textContent);
    let picks = [];
    root.classList.add('lab');
    const body = el('div');
    body.tabIndex = -1;
    root.replaceChildren(body);

    function showPair() {
      const i = picks.length, pair = data.pairs[i];
      body.replaceChildren(el('div', 'lab-step', `Choice ${i + 1} of ${data.pairs.length}`), el('p', 'lab-q', pair.q));
      const box = el('div', 'lab-pair');
      pair.a.forEach((answer, k) => {
        const b = el('button', 'lab-answer', answer.text);
        b.type = 'button';
        b.addEventListener('click', () => {
          picks.push(k);
          picks.length < data.pairs.length ? showPair() : showResult();
          body.focus({ preventScroll: true });
        });
        box.appendChild(b);
      });
      body.appendChild(box);
      body.appendChild(el('p', 'lab-hint', 'Pick the answer you would rather get.'));
    }

    function showResult() {
      const diffs = data.pairs.map((p, i) => p.a[picks[i]].f.map((v, j) => v - p.a[1 - picks[i]].f[j]));
      const w = fit(diffs, data.traits.length);
      const agree = diffs.filter(d => dot(w, d) > 1e-9).length;
      const scored = data.test.answers.map(a => ({ ...a, score: dot(w, a.f) })).sort((a, b) => b.score - a.score);
      const tied = scored.filter(a => Math.abs(a.score - scored[0].score) < 0.005).length > 1;

      body.replaceChildren(el('div', 'lab-step', 'Your reward model'),
        el('p', 'lab-note', `What it learned to reward from your ${data.pairs.length} choices. It agrees with ${agree} of them.`));
      const max = Math.max(0.5, ...w.map(Math.abs));
      data.traits.forEach((t, i) => {
        const row = el('div', 'lab-weight'), track = el('span', 'lab-track'), bar = el('span', 'lab-bar');
        const size = 50 * Math.abs(w[i]) / max;
        bar.style.width = size + '%';
        bar.style.left = (w[i] < 0 ? 50 - size : 50) + '%';
        bar.classList.add(w[i] < 0 ? 'is-neg' : 'is-pos');
        track.appendChild(bar);
        row.append(el('span', 'lab-trait', t), track, el('span', 'lab-num', signed(w[i])));
        body.appendChild(row);
      });

      body.append(el('div', 'lab-step lab-gap', 'Now it judges new answers'), el('p', 'lab-q', data.test.q));
      const list = el('ol', 'lab-ranked');
      scored.forEach(a => {
        const li = el('li');
        const tags = el('div', 'lab-tags');
        tags.append(el('span', '', 'Score ' + signed(a.score)), el('span', a.right ? 'is-right' : 'is-wrong', a.right ? '✓ True' : '✗ False'));
        li.append(el('div', '', a.text), tags);
        list.appendChild(li);
      });
      body.appendChild(list);
      const verdict = tied ? 'Its top answers are tied, so your choices did not settle it.'
        : scored[0].right ? 'Its favorite happens to be true. It had no way of knowing: no part of it checks facts.'
        : 'Its favorite is false. It had no way of knowing: no part of it checks facts.';
      body.appendChild(el('p', 'lab-note', verdict));
      const again = el('button', 'lab-again', 'Start over');
      again.type = 'button';
      again.addEventListener('click', () => { picks = []; showPair(); body.focus({ preventScroll: true }); });
      body.appendChild(again);
    }
    showPair();
  }

  window.RewardLab = { mount, fit };
  document.querySelectorAll('[data-reward-lab]').forEach(root => {
    try { mount(root); } catch (err) { console.error('RewardLab: could not mount figure', root, err); }
  });
})();
