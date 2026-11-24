#!/usr/bin/env python3
"""Keep the site's generated parts in sync with the essays.

    python3 _tools/build.py            update everything
    python3 _tools/build.py --check    change nothing; fail if something is out of date or broken

Reads each essays/<slug>/index.html and generates:
  - the essay list in index.html          (between build:essays markers)
  - previous/next links in each essay     (between build:nav markers)
  - each essay's byline, date, reading time, search title and article data
  - the definitions in glossary/index.html, from glossary.js
  - feed.xml and sitemap.xml
  - a share card per essay, essays/<slug>/og-image.png (needs Google Chrome)

Everything is worked out and validated first. If any check fails, no file is written.
Unfinished essays belong in _drafts/<slug>/, which neither this script nor GitHub Pages publishes.
Standard library only.
"""
import argparse
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import xml.dom.minidom
from datetime import date, datetime
from email.utils import format_datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
SITE = 'https://allyouneedisattention.com'
SITE_TITLE = 'All You Need Is Attention'
FEED_DESCRIPTION = 'Essays on AI and what came after “Attention Is All You Need.”'
AUTHOR = 'Madhu'
AUTHOR_LINKS = ['https://x.com/madhu_jayakumar', 'https://www.linkedin.com/in/madhu-jayakumar/',
                'https://madhujayakumar.com/']
WORDS_PER_MINUTE = 230
PAGES = ['index.html', 'glossary/index.html', 'about/index.html']  # besides the essays
CHROME = [
    os.environ.get('CHROME', ''),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'google-chrome', 'chromium',
]


class BuildError(Exception):
    pass


def esc(text):
    return html.escape(text, quote=True)


def plain(fragment):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', fragment))).strip()


def find(pattern, text, what, where):
    hits = re.findall(pattern, text, re.S)
    if len(hits) != 1:
        raise BuildError(f'{where}: expected exactly one {what}, found {len(hits)}')
    return hits[0]


def replace_once(pattern, new, text, what, where):
    find(pattern, text, what, where)
    return re.sub(pattern, lambda _: new, text, count=1, flags=re.S)


def fill_marker(text, name, content, where):
    pattern = rf'<!-- build:{name} -->.*?<!-- /build:{name} -->'
    return replace_once(pattern, f'<!-- build:{name} -->\n{content}\n<!-- /build:{name} -->',
                        text, f'build:{name} block', where)


def json_ld(data):
    # "<" is escaped so no text can close the script tag early.
    text = json.dumps(data, ensure_ascii=False, indent=1).replace('<', '\\u003c')
    return f'<script type="application/ld+json">\n{text}\n</script>'


# ---------- Reading essays ----------

def parse_time(stamp, what, rel):
    try:
        moment = datetime.fromisoformat(stamp)
    except ValueError:
        raise BuildError(f'{rel}: bad {what} {stamp!r} (want 2026-11-24T16:24:00-05:00)')
    if moment.tzinfo is None:
        raise BuildError(f'{rel}: {what} {stamp!r} needs a timezone')
    return moment


def load_glossary():
    source = (ROOT / 'glossary.js').read_text(encoding='utf-8')
    block = find(r'const GLOSSARY = \{\n(.*?)\n  \};', source, 'GLOSSARY list', 'glossary.js')
    entries = re.findall(r"^    '([a-z0-9-]+)': \{\n      term: '((?:[^'\\\n]|\\.)*)',\n"
                         r"      def: '((?:[^'\\\n]|\\.)*)'\n    \},?$", block, re.M)
    keys = [e[0] for e in entries]
    if not entries or len(entries) != len(re.findall(r'\bterm:', block)) or len(entries) != block.count('    },'):
        raise BuildError("glossary.js: an entry isn't in the usual form (key, then term and def in single quotes)")
    if len(set(keys)) != len(keys):
        raise BuildError('glossary.js: the same key appears twice')
    clean = lambda t: re.sub(r'\\(.)', r'\1', t)
    return sorted(((k, clean(t), clean(d)) for k, t, d in entries), key=lambda e: e[1].lower())


def reading_minutes(text, where):
    start = text.find('<div class="prose">')
    if start < 0:
        raise BuildError(f'{where}: no <div class="prose">')
    end = text.find('<section class="footnotes"', start)
    body = text[start:end if end >= 0 else len(text)]
    body = re.sub(r'<!--.*?-->|<pre>.*?</pre>|<figure.*?</figure>|<script.*?</script>', ' ', body, flags=re.S)
    return max(1, round(len(re.sub(r'<[^>]+>', ' ', body).split()) / WORDS_PER_MINUTE))


def load_essays():
    essays = []
    for path in sorted((ROOT / 'essays').glob('*/index.html')):
        rel = path.relative_to(ROOT).as_posix()
        text = path.read_text(encoding='utf-8')
        stamp = find(r'<meta property="article:published_time" content="([^"]*)">', text,
                     'article:published_time tag', rel)
        published = parse_time(stamp, 'published time', rel)
        modified = re.findall(r'<meta property="article:modified_time" content="([^"]*)">', text)
        if len(modified) > 1:
            raise BuildError(f'{rel}: more than one article:modified_time tag')
        modified = parse_time(modified[0], 'modified time', rel) if modified else published
        if modified < published:
            raise BuildError(f'{rel}: modified before it was published')
        essays.append({
            'slug': path.parent.name, 'rel': rel, 'text': text, 'published': published,
            'title': plain(find(r'<h1>(.*?)</h1>', text, '<h1>', rel)),
            'summary': plain(find(r'<p class="dek">(.*?)</p>', text, 'summary (class="dek")', rel)),
            'minutes': reading_minutes(text, rel), 'modified': modified,
            'search_title': html.unescape(find(r'<meta name="search-title" content="([^"]+)">', text,
                                               'search-title tag', rel)),
        })
    if not essays:
        raise BuildError('no essays found')
    essays.sort(key=lambda e: (e['published'], e['slug']), reverse=True)
    return essays


def url_path(essay):
    return f"/essays/{quote(essay['slug'])}/"


def long_date(moment):
    return f'{moment:%B} {moment.day}, {moment.year}'


def time_tag(essay):
    moment = essay['published']
    return f'<time datetime="{moment:%Y-%m-%d}">{long_date(moment)}</time> · {essay["minutes"]} min read'


# ---------- Generating ----------

def render_essay(essay, older, newer):
    rel, text = essay['rel'], essay['text']
    url = SITE + url_path(essay)
    title, summary = esc(essay['title']), esc(essay['summary'])
    byline = f'By <a rel="author" href="/about/">{esc(AUTHOR)}</a> · '
    for pattern, new, what in [
        (r'<title>.*?</title>', f'<title>{esc(essay["search_title"])}</title>', '<title>'),
        (r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{summary}">', 'description'),
        (r'<meta property="og:title" content="[^"]*">', f'<meta property="og:title" content="{title}">', 'og:title'),
        (r'<meta property="og:description" content="[^"]*">', f'<meta property="og:description" content="{summary}">', 'og:description'),
        (r'<meta property="og:url" content="[^"]*">', f'<meta property="og:url" content="{url}">', 'og:url'),
        (r'<link rel="canonical" href="[^"]*">', f'<link rel="canonical" href="{url}">', 'canonical link'),
        (r'<meta property="og:image" content="[^"]*">', f'<meta property="og:image" content="{url}og-image.png">', 'og:image'),
        (r'<meta property="og:image:alt" content="[^"]*">', f'<meta property="og:image:alt" content="{title}, an essay from {SITE_TITLE}.">', 'og:image:alt'),
        (r'<div class="meta">.*?</div>', f'<div class="meta">{byline}{time_tag(essay)}</div>', 'date line'),
    ]:
        text = replace_once(pattern, new, text, what, rel)

    links = []
    for other, cls, label in [(older, 'prev', '← Previous'), (newer, 'next', 'Next →')]:
        if other:
            links.append(f'    <a class="{cls}" rel="{cls}" href="{url_path(other)}">'
                         f'<span>{label}</span>{esc(other["title"])}</a>')
    nav = '\n'.join(['    <nav class="essay-nav" aria-label="More essays">', *('  ' + l for l in links),
                     '    </nav>']) if links else ''
    text = fill_marker(text, 'nav', nav, rel)
    return fill_marker(text, 'data', json_ld({
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        'headline': essay['title'],
        'description': essay['summary'],
        'image': f'{url}og-image.png',
        'datePublished': essay['published'].isoformat(),
        'dateModified': essay['modified'].isoformat(),
        'author': {'@type': 'Person', 'name': AUTHOR, 'url': f'{SITE}/about/', 'sameAs': AUTHOR_LINKS},
        'mainEntityOfPage': url,
    }), rel)


def render_glossary(text):
    items = '\n'.join(f'        <dt id="{key}">{esc(term)}</dt>\n        <dd>{esc(definition)}</dd>'
                      for key, term, definition in load_glossary())
    return fill_marker(text, 'glossary', items, 'glossary/index.html')


def render_home(essays):
    items = '\n'.join(f'''      <li>
        <a href="{url_path(e)}">
          <h3>{esc(e['title'])}</h3>
          <p>{esc(e['summary'])}</p>
          <div class="meta">{time_tag(e)}</div>
        </a>
      </li>''' for e in essays)
    return fill_marker((ROOT / 'index.html').read_text(encoding='utf-8'), 'essays', items, 'index.html')


def render_feed(essays):
    def item(e):
        url = SITE + url_path(e)
        return f'''    <item>
      <title>{esc(e['title'])}</title>
      <link>{url}</link>
      <guid isPermaLink="true">{url}</guid>
      <pubDate>{format_datetime(e['published'])}</pubDate>
      <description>{esc(e['summary'])}</description>
    </item>'''
    items = '\n\n'.join(item(e) for e in essays)
    return f'''<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by _tools/build.py. Edit the essays, not this file. -->
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>{SITE_TITLE}</title>
    <link>{SITE}/</link>
    <atom:link href="{SITE}/feed.xml" rel="self" type="application/rss+xml"/>
    <description>{esc(FEED_DESCRIPTION)}</description>
    <language>en</language>
    <lastBuildDate>{format_datetime(essays[0]['published'])}</lastBuildDate>

{items}
  </channel>
</rss>
'''


def last_changed(rel, changed):
    """Today if the page has uncommitted changes, otherwise the date of its last commit."""
    def git(*args):
        return subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    sources = [rel, 'glossary.js'] if rel == 'glossary/index.html' else [rel]
    if changed or git('status', '--porcelain', '--', *sources):
        return date.today().isoformat()
    return git('log', '-1', '--format=%cs', '--', *sources) or date.today().isoformat()


def render_sitemap(essays, changed):
    rels = [PAGES[0], *(e['rel'] for e in essays), *PAGES[1:]]
    rows = '\n'.join(f"  <url><loc>{SITE}/{quote(rel.removesuffix('index.html'))}</loc>"
                     f'<lastmod>{last_changed(rel, rel in changed)}</lastmod></url>' for rel in rels)
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<!-- Generated by _tools/build.py. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{rows}
</urlset>
'''


# ---------- Checking ----------

class Page(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.ids, self.links, self.terms, self.json = [], [], [], []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if a.get('id'):
            self.ids.append(a['id'])
        for key in ('href', 'src'):
            if a.get(key) and tag != 'base':
                self.links.append(a[key])
        if 'data-term' in a:
            self.terms.append(a['data-term'])
        for key in ('data-tokens', 'data-weights', 'data-examples'):
            if key in a:
                self.json.append((key, a[key]))


def check_pages(pages, cards):
    """pages: {rel: text}. Returns a list of problems."""
    problems = []
    parsed = {rel: Page(text) for rel, text in pages.items()}
    keys = {key for key, _, _ in load_glossary()}

    def target(rel, link):
        parts = urlsplit(link)
        if link.startswith(SITE):
            link = link[len(SITE):] or '/'
            parts = urlsplit(link)
        if parts.scheme or parts.netloc:
            return None
        if not parts.path:
            return rel, unquote(parts.fragment)
        base = ROOT if parts.path.startswith('/') else (ROOT / rel).parent
        path = Path(os.path.normpath(base / unquote(parts.path).lstrip('/')))
        if parts.path.endswith('/'):
            path = path / 'index.html'
        return os.path.relpath(path, ROOT), unquote(parts.fragment)

    for rel, page in parsed.items():
        text = pages[rel]
        for link in page.links:
            found = target(rel, link)
            if not found:
                continue
            dest, anchor = found
            if dest not in pages and dest not in cards and not (ROOT / dest).is_file():
                problems.append(f'{rel}: broken link {link}')
            elif anchor and dest in parsed and anchor not in parsed[dest].ids:
                problems.append(f'{rel}: link to missing section {link}')
        for term in page.terms:
            if term not in keys:
                problems.append(f'{rel}: no glossary entry for "{term}"')
        for dupe in sorted({i for i in page.ids if page.ids.count(i) > 1}):
            problems.append(f'{rel}: id "{dupe}" used more than once')
        for key, value in page.json:
            try:
                json.loads(re.sub(r'(^|[^\d])\.(\d)', r'\g<1>0.\2', value))
            except ValueError as err:
                problems.append(f'{rel}: {key} is not valid ({err})')
        for block in re.findall(r'<script type="application/(?:ld\+)?json">(.*?)</script>', text, re.S):
            try:
                json.loads(block)
            except ValueError as err:
                problems.append(f'{rel}: figure data is not valid ({err})')
        if rel.startswith('essays/'):
            notes = [int(n) for n in re.findall(r'id="fn(\d+)"', text)]
            refs = [int(n) for n in re.findall(r'id="ref(\d+)"', text)]
            if notes != list(range(1, len(notes) + 1)) or refs != notes:
                problems.append(f'{rel}: footnotes out of order (notes {notes}, references {refs})')
            for left in re.findall(r'ESSAY TITLE|SEARCH TITLE|ONE-SENTENCE SUMMARY|ONE- OR TWO-SENTENCE|YYYY-MM-DD|MONTH D, YYYY'
                                   r'|N min read|Go deeper: TOPIC|CAPTION\.|XXXX\.XXXXX|\(YEAR\)|/SLUG/', text):
                problems.append(f'{rel}: template placeholder left in: {left}')
        if rel != '404.html' and not re.search(r'<meta name="description" content="[^"]{50,}">', text):
            problems.append(f'{rel}: description is missing or under 50 characters')
        if re.search(r'^(<{7}|>{7}) ', text, re.M):
            problems.append(f'{rel}: unresolved merge conflict')
    return problems


# ---------- Share cards ----------

def card_html(essay):
    template = (ROOT / '_assets/essay-card.html').read_text(encoding='utf-8')
    size = 92 if len(essay['title']) <= 26 else 76 if len(essay['title']) <= 48 else 60
    return template.replace('{{TITLE}}', esc(essay['title'])).replace('{{SIZE}}', str(size))


def render_card(source, out):
    chrome = next((c for c in CHROME if c and shutil.which(c)), None)
    if not chrome:
        raise BuildError('share cards need Google Chrome (set CHROME to its path)')
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / 'card.html'
        page.write_text(source, encoding='utf-8')
        shot = Path(tmp) / 'card.png'
        try:
            subprocess.run([chrome, '--headless', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
                            f'--user-data-dir={tmp}/profile', '--force-device-scale-factor=1',
                            '--window-size=1200,630', f'--screenshot={shot}', page.as_uri()],
                           capture_output=True, timeout=60)
        except subprocess.TimeoutExpired:
            pass  # judged by the file below
        data = shot.read_bytes() if shot.is_file() else b''
        if data[:8] != b'\x89PNG\r\n\x1a\n' or data[16:24] != (1200).to_bytes(4, 'big') + (630).to_bytes(4, 'big'):
            raise BuildError(f'Chrome did not produce a 1200×630 image for {out}')
        return data


# ---------- Main ----------

def write_atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + '.tmp')
    tmp.write_bytes(data)
    os.replace(tmp, path)


def build(check):
    essays = load_essays()
    pages = {}
    for i, essay in enumerate(essays):
        pages[essay['rel']] = render_essay(
            essay, essays[i + 1] if i + 1 < len(essays) else None, essays[i - 1] if i else None)
    pages['index.html'] = render_home(essays)
    for rel in [*PAGES[1:], '404.html']:
        pages[rel] = (ROOT / rel).read_text(encoding='utf-8')
    pages['glossary/index.html'] = render_glossary(pages['glossary/index.html'])

    cards = {f"essays/{e['slug']}/og-image.png": card_html(e) for e in essays}
    problems = check_pages(pages, cards)
    if problems:
        raise BuildError('\n  '.join(['problems found:', *problems]))

    def differs(rel, text):
        path = ROOT / rel
        return not path.is_file() or path.read_text(encoding='utf-8') != text

    changed = {rel for rel, text in pages.items() if differs(rel, text)}
    outputs = {rel: pages[rel] for rel in changed}
    for rel, text in [('feed.xml', render_feed(essays)), ('sitemap.xml', render_sitemap(essays, changed))]:
        xml.dom.minidom.parseString(text.encode('utf-8'))
        if differs(rel, text):
            outputs[rel] = text

    # A card is redrawn only when its design or title changes.
    manifest_rel = '_assets/cards.json'
    manifest_path = ROOT / manifest_rel
    old = json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.is_file() else {}
    hashes = {rel: hashlib.sha256(src.encode('utf-8')).hexdigest()[:16] for rel, src in cards.items()}
    stale = [rel for rel in cards if old.get(rel) != hashes[rel] or not (ROOT / rel).is_file()]
    manifest = json.dumps(hashes, indent=2, sort_keys=True) + '\n'
    if differs(manifest_rel, manifest):
        outputs[manifest_rel] = manifest

    todo = sorted([*outputs, *stale])
    if check:
        if todo:
            raise BuildError('\n  '.join(['out of date, run python3 _tools/build.py:', *todo]))
        print(f'OK: {len(essays)} essays, everything up to date.')
        return

    files = {rel: text.encode('utf-8') for rel, text in outputs.items()}
    files.update({rel: render_card(cards[rel], rel) for rel in stale})
    for rel in sorted(files):
        write_atomic(ROOT / rel, files[rel])
        print('updated', rel)
    print(f'OK: {len(essays)} essays, {len(files)} files updated.')


def main():
    parser = argparse.ArgumentParser(description='Update the generated parts of the site.')
    parser.add_argument('--check', action='store_true', help='change nothing; fail if out of date or broken')
    try:
        build(parser.parse_args().check)
    except BuildError as err:
        sys.exit(f'Build stopped, nothing written. {err}')


if __name__ == '__main__':
    main()
