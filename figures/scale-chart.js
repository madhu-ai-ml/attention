/*
  Scale chart: lines of score against model size, with a switch between a
  plain size axis and one where each step multiplies the size.

  Embed in an essay:

    <figure class="fig">
      <div data-scale-chart>
        <script type="application/json">
          {"x": [125, 350], "xNames": ["125 million", "350 million"],
           "xTicks": [[1000, "1B"]], "linearTicks": [[50000, "50B"]],
           "series": [{"name": "Task", "values": [1, 2]}]}
        </script>
      </div>
      <figcaption>…</figcaption>
    </figure>
    <script src="/figures/scale-chart.js"></script>

  Values are percentages, 0 to 100. Up to three series.
*/
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  // Validated for color-vision deficiency on this site's dark surface.
  const COLORS = ['#3987e5', '#d95926', '#199e70'];
  const H = 320, TOP = 14, BOTTOM = 44, LEFT = 42, RIGHT = 14;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function svgEl(tag, attrs, text) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    return e;
  }
  const pct = v => v.toFixed(1) + '%';

  function mount(root) {
    const data = JSON.parse(root.querySelector('script[type="application/json"]').textContent);
    let log = false, at = -1;
    root.classList.add('scale');

    const controls = el('div', 'scale-controls');
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', 'Size axis');
    const modes = ['Plain axis', 'Multiplying axis'].map((name, i) => {
      const b = el('button', '', name);
      b.type = 'button';
      b.addEventListener('click', () => { log = i === 1; draw(); });
      controls.appendChild(b);
      return b;
    });

    const legend = el('div', 'scale-legend');
    data.series.forEach((s, i) => {
      const item = el('span', 'scale-key');
      const line = el('i');
      line.style.background = COLORS[i];
      item.append(line, document.createTextNode(s.name));
      legend.appendChild(item);
    });

    const plot = el('div', 'scale-plot');
    plot.tabIndex = 0;
    plot.setAttribute('role', 'group');
    plot.setAttribute('aria-label', 'Chart of score by model size. Use the left and right arrow keys to read each size.');
    const tip = el('div', 'scale-tip');
    tip.hidden = true;
    const live = el('div', 'visually-hidden');
    live.setAttribute('aria-live', 'polite');

    const details = el('details', 'scale-table');
    details.appendChild(el('summary', '', 'Show the numbers'));
    const table = el('table'), head = el('tr');
    head.appendChild(el('th', '', 'Size'));
    data.series.forEach(s => head.appendChild(el('th', '', s.name)));
    table.appendChild(head);
    data.x.forEach((_, j) => {
      const tr = el('tr');
      tr.appendChild(el('th', '', data.xNames[j]));
      data.series.forEach(s => tr.appendChild(el('td', '', pct(s.values[j]))));
      table.appendChild(tr);
    });
    const scroll = el('div', 'scale-table-scroll');
    scroll.appendChild(table);
    details.appendChild(scroll);
    root.replaceChildren(controls, legend, plot, live, details);

    let X = [], W = 0;
    function draw() {
      modes.forEach((b, i) => b.setAttribute('aria-pressed', String((i === 1) === log)));
      W = Math.max(220, plot.clientWidth);
      const lo = log ? Math.log(data.x[0]) : 0, hi = log ? Math.log(data.x[data.x.length - 1]) : data.x[data.x.length - 1];
      const px = v => LEFT + (W - LEFT - RIGHT) * ((log ? Math.log(v) : v) - lo) / (hi - lo);
      const py = v => TOP + (H - TOP - BOTTOM) * (1 - v / 100);
      X = data.x.map(px);

      const svg = svgEl('svg', { width: W, height: H, 'aria-hidden': 'true' });
      [0, 25, 50, 75, 100].forEach(v => {
        svg.appendChild(svgEl('line', { x1: LEFT, x2: W - RIGHT, y1: py(v), y2: py(v), class: 'scale-grid' }));
        svg.appendChild(svgEl('text', { x: LEFT - 8, y: py(v) + 4, 'text-anchor': 'end' }, v + '%'));
      });
      (log ? data.xTicks : data.linearTicks).forEach(([v, name]) => {
        svg.appendChild(svgEl('text', { x: px(v), y: H - BOTTOM + 18, 'text-anchor': 'middle' }, name));
      });
      svg.appendChild(svgEl('text', { x: (LEFT + W - RIGHT) / 2, y: H - 6, 'text-anchor': 'middle' }, 'Parameters in the model'));
      const cross = svgEl('line', { y1: TOP, y2: H - BOTTOM, class: 'scale-cross', visibility: 'hidden' });
      svg.appendChild(cross);
      const dots = data.series.map((s, i) => {
        svg.appendChild(svgEl('polyline', { points: s.values.map((v, j) => `${X[j].toFixed(1)},${py(v).toFixed(1)}`).join(' '), class: 'scale-line', stroke: COLORS[i] }));
        return s.values.map((v, j) => {
          const c = svgEl('circle', { cx: X[j], cy: py(v), r: 4, fill: COLORS[i], class: 'scale-dot' });
          svg.appendChild(c);
          return c;
        });
      });
      plot.replaceChildren(svg, tip);
      plot._show = j => {
        at = j;
        dots.forEach(row => row.forEach((c, k) => c.setAttribute('r', k === j ? 6 : 4)));
        cross.setAttribute('visibility', j < 0 ? 'hidden' : 'visible');
        tip.hidden = j < 0;
        if (j < 0) return;
        cross.setAttribute('x1', X[j]);
        cross.setAttribute('x2', X[j]);
        tip.replaceChildren(el('div', 'scale-tip-head', data.xNames[j] + ' parameters'));
        data.series.forEach((s, i) => {
          const row = el('div', 'scale-tip-row'), key = el('i');
          key.style.background = COLORS[i];
          row.append(key, el('strong', '', pct(s.values[j])), el('span', '', s.name));
          tip.appendChild(row);
        });
        const w = tip.offsetWidth;
        tip.style.left = Math.max(0, Math.min(W - w, X[j] + 12 + w > W ? X[j] - w - 12 : X[j] + 12)) + 'px';
      };
      plot._show(at);
    }

    const nearest = e => {
      const x = e.clientX - plot.getBoundingClientRect().left;
      return X.reduce((best, v, j) => (Math.abs(v - x) < Math.abs(X[best] - x) ? j : best), 0);
    };
    plot.addEventListener('pointermove', e => plot._show(nearest(e)));
    plot.addEventListener('pointerdown', e => plot._show(nearest(e)));
    plot.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') plot._show(-1); });
    plot.addEventListener('blur', () => plot._show(-1));
    plot.addEventListener('keydown', e => {
      const last = data.x.length - 1;
      let j = at;
      if (e.key === 'ArrowRight') j = Math.min(last, at + 1);
      else if (e.key === 'ArrowLeft') j = at < 0 ? last : Math.max(0, at - 1);
      else if (e.key === 'Escape') j = -1;
      else return;
      e.preventDefault();
      plot._show(j);
      live.textContent = j < 0 ? '' : `${data.xNames[j]} parameters: ` + data.series.map(s => `${s.name} ${pct(s.values[j])}`).join(', ');
    });
    new ResizeObserver(() => { if (plot.clientWidth !== W) draw(); }).observe(plot);
    draw();
  }

  window.ScaleChart = { mount };
  document.querySelectorAll('[data-scale-chart]').forEach(root => {
    try { mount(root); } catch (err) { console.error('ScaleChart: could not mount figure', root, err); }
  });
})();
