/*
  Attention arcs: draws curved lines from one word to every other word,
  thicker and brighter where the attention weight is larger.

  Embed in an essay (builds its own markup):

    <figure class="fig">
      <div data-attention-arcs
           data-tokens='["The","cat","sat"]'
           data-weights='[[.2,.6,.2],[.3,.3,.4],[.1,.6,.3]]'
           data-start="1"
           data-autoplay="false"></div>
      <figcaption>…</figcaption>
    </figure>
    <script src="/figures/attention-arcs.js"></script>

  weights[i][j] = how much word i attends to word j (each row should sum to ~1).
  Hover, focus or tap a word to show its arcs.

  Or attach to existing markup from your own script:
    AttentionArcs.attach({ stage, tokens, svg, weights, start, autoplay })
*/
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function attach({ stage, tokens, svg, weights, start = 0, autoplay = false, interval = 2600 }) {
    let current = -1, timer = null, userHover = false;

    function draw(i) {
      current = i;
      tokens.forEach((t, k) => {
        t.classList.toggle('active', k === i);
        if (t.tagName === 'BUTTON') t.setAttribute('aria-pressed', k === i ? 'true' : 'false');
      });
      svg.replaceChildren();
      if (i < 0) return;
      const s = stage.getBoundingClientRect();
      const centers = tokens.map(t => {
        const r = t.getBoundingClientRect();
        return { x: r.left + r.width / 2 - s.left, y: r.bottom - s.top + 6 };
      });
      weights[i].forEach((w, j) => {
        if (w <= 0) return;
        const a = centers[i], b = centers[j];
        const p = document.createElementNS(NS, 'path');
        if (i === j) {
          // Self-attention: a small loop under the word.
          const r = 18 + w * 60;
          p.setAttribute('d', `M${a.x - 10},${a.y} C${a.x - 24},${a.y + r} ${a.x + 24},${a.y + r} ${a.x + 10},${a.y}`);
        } else {
          const depth = Math.min(24 + Math.abs(b.x - a.x) * 0.1, 64);
          p.setAttribute('d', `M${a.x},${a.y} Q${(a.x + b.x) / 2},${a.y + depth * 2} ${b.x},${b.y}`);
        }
        p.style.strokeWidth = (1 + w * 9).toFixed(1);
        p.style.opacity = Math.min(1, 0.12 + w * 1.4).toFixed(2);
        svg.appendChild(p);
      });
    }

    tokens.forEach((t, i) => {
      t.addEventListener('mouseenter', () => { userHover = true; draw(i); });
      t.addEventListener('focus',      () => { userHover = true; draw(i); });
      t.addEventListener('click',      () => draw(i));
      t.addEventListener('mouseleave', () => { userHover = false; });
      t.addEventListener('blur',       () => { userHover = false; });
    });
    addEventListener('resize', () => draw(current));
    document.fonts && document.fonts.ready.then(() => draw(current));

    draw(start);
    if (autoplay && !reduce) {
      let n = start;
      timer = setInterval(() => {
        if (!userHover) draw(n = (n + 1) % tokens.length);
      }, interval);
    }
    return { draw, stop: () => clearInterval(timer) };
  }

  function mount(el) {
    const words = JSON.parse(el.dataset.tokens);
    // Allow shorthand like .25 (not valid JSON) by adding the leading zero.
    const weights = JSON.parse(el.dataset.weights.replace(/(^|[^\d])\.(\d)/g, '$10.$2'));
    const start = Number(el.dataset.start || 0);
    const autoplay = el.dataset.autoplay === 'true';

    el.classList.add('arcs-scroll');
    const stage = document.createElement('div');
    stage.className = 'arcs-stage';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'arcs');
    svg.setAttribute('aria-hidden', 'true');
    stage.appendChild(svg);

    const tokens = words.map(w => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tok';
      b.textContent = w;
      stage.appendChild(b);
      return b;
    });
    el.replaceChildren(stage);
    return attach({ stage, tokens, svg, weights, start, autoplay });
  }

  window.AttentionArcs = { attach, mount };
  document.querySelectorAll('[data-attention-arcs]').forEach(el => {
    try { mount(el); } catch (err) { console.error('AttentionArcs: could not mount figure', el, err); }
  });
})();
