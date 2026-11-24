/*
  Glossary: one list of definitions, used in two ways.

  1. In essays, mark a term with:
       <span class="term" data-term="token">tokens</span>
     Hovering, focusing or tapping it shows the definition.
  2. On /glossary/, an element with id="glossary-list" is filled with every entry.

  To add a term, add an entry below (keys are lowercase, kebab-case).
*/
(() => {
  const GLOSSARY = {
    'attention': {
      term: 'Attention',
      def: 'A mechanism that lets each token look at every other token and work out how much each one matters for understanding it. The weights are computed fresh for each input, using parameters learned in training.'
    },
    'transformer': {
      term: 'Transformer',
      def: 'The neural-network architecture introduced in “Attention Is All You Need” (2017). It is built from stacked layers of attention and small feed-forward networks, with no recurrence.'
    },
    'token': {
      term: 'Token',
      def: 'The unit of text a model reads and writes: usually a word or a piece of a word. GPT-2’s tokenizer splits “unbelievable” into “un”, “bel”, “iev” and “able”.'
    },
    'tokenizer': {
      term: 'Tokenizer',
      def: 'The program that splits text into tokens and turns each one into an ID number before a model sees it, and turns IDs back into text afterward.'
    },
    'vocabulary': {
      term: 'Vocabulary',
      def: 'The fixed list of tokens a tokenizer can produce. Each entry has an ID number. Typical sizes range from about 50,000 to a few hundred thousand.'
    },
    'bpe': {
      term: 'Byte-pair encoding (BPE)',
      def: 'The most common way to build a tokenizer’s vocabulary: start from single characters (or bytes) and repeatedly merge the most frequent neighboring pair into a new token.'
    },
    'context-window': {
      term: 'Context window',
      def: 'The maximum number of tokens a model can take into account at once, covering both your input and its reply.'
    },
    'embedding': {
      term: 'Embedding',
      def: 'A list of numbers (a vector) that represents a token. Tokens with related meanings end up with similar embeddings.'
    },
    'parameters': {
      term: 'Parameters',
      def: 'The numbers inside a model that are adjusted during training. “175 billion parameters” means 175 billion of these adjustable weights.'
    },
    'pretraining': {
      term: 'Pretraining',
      def: 'The first, most expensive stage of training, where a model learns general patterns from a huge amount of text, usually by predicting missing or next words.'
    },
    'fine-tuning': {
      term: 'Fine-tuning',
      def: 'Further training of a pretrained model on a smaller, focused dataset to adapt it to a particular task or style.'
    },
    'prompt': {
      term: 'Prompt',
      def: 'The text you give a model as input. A model’s output is its continuation of, or response to, the prompt.'
    },
    'gpu': {
      term: 'GPU',
      def: 'Graphics processing unit. A chip built to do many simple calculations at once, originally for graphics, now the workhorse of AI training.'
    },
    'softmax': {
      term: 'Softmax',
      def: 'A function that turns a list of scores into positive weights that add up to 1, exaggerating the gap between large and small scores.'
    },
    'rlhf': {
      term: 'RLHF',
      def: 'Reinforcement learning from human feedback. People compare or rank model responses, and the model is tuned toward the responses they prefer.'
    },
    'scaling-laws': {
      term: 'Scaling laws',
      def: 'Empirical rules showing that a model’s error falls smoothly and predictably as you increase its size, training data and compute.'
    },
  };

  /* ---------- Glossary page ---------- */
  const list = document.getElementById('glossary-list');
  if (list) {
    Object.entries(GLOSSARY)
      .sort((a, b) => a[1].term.localeCompare(b[1].term))
      .forEach(([key, { term, def }]) => {
        const dt = document.createElement('dt');
        dt.id = key;
        dt.textContent = term;
        const dd = document.createElement('dd');
        dd.textContent = def;
        list.append(dt, dd);
      });
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }

  /* ---------- Inline term tooltips ---------- */
  const terms = [...document.querySelectorAll('.term[data-term]')];
  if (!terms.length) return;

  const tip = document.createElement('div');
  tip.className = 'term-tip';
  tip.id = 'term-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.appendChild(tip);

  let openEl = null, hideTimer = null;

  function show(el) {
    const entry = GLOSSARY[el.dataset.term];
    if (!entry) return;
    clearTimeout(hideTimer);
    if (openEl && openEl !== el) openEl.classList.remove('is-open');
    openEl = el;
    el.classList.add('is-open');
    el.setAttribute('aria-describedby', tip.id);

    tip.replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = entry.term;
    const p = document.createElement('span');
    p.textContent = entry.def + ' ';
    const more = document.createElement('a');
    more.href = '/glossary/#' + el.dataset.term;
    more.textContent = 'Glossary →';
    tip.append(strong, p, more);
    tip.hidden = false;

    // Position below the term, kept inside the viewport.
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(12, Math.min(left, document.documentElement.clientWidth - w - 12));
    let top = r.bottom + 8;
    if (top + h > innerHeight - 8 && r.top - h - 8 > 0) top = r.top - h - 8;
    tip.style.left = left + scrollX + 'px';
    tip.style.top = top + scrollY + 'px';
  }

  function hide() {
    if (!openEl) return;
    openEl.classList.remove('is-open');
    openEl.removeAttribute('aria-describedby');
    openEl = null;
    tip.hidden = true;
  }
  const hideSoon = () => { hideTimer = setTimeout(hide, 150); };

  terms.forEach(el => {
    if (!GLOSSARY[el.dataset.term]) {
      console.warn('Glossary: no entry for', el.dataset.term);
      return;
    }
    el.tabIndex = 0;
    el.addEventListener('mouseenter', () => show(el));
    el.addEventListener('mouseleave', hideSoon);
    el.addEventListener('focus', () => show(el));
    el.addEventListener('blur', hideSoon);
    // Tap opens (taps also fire mouseenter, so don't toggle). Tap elsewhere or Esc closes.
    el.addEventListener('click', e => {
      e.stopPropagation();
      show(el);
    });
  });

  tip.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  tip.addEventListener('mouseleave', hideSoon);
  document.addEventListener('click', e => { if (!tip.contains(e.target)) hide(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
  addEventListener('resize', hide);
})();
