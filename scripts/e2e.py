# Two-browser smoke test against `npm run preview` (http://localhost:8080).
# Needs Python Playwright + Chrome. Usage: python3 scripts/e2e.py gin-rummy "Create game" Pass
import re, sys
from playwright.sync_api import sync_playwright
B='http://localhost:8080'
game, create_txt = sys.argv[1], sys.argv[2]
with sync_playwright() as p:
    br=p.chromium.launch(args=['--no-sandbox'])
    errs=[]
    def page():
        pg=br.new_context(viewport={'width':430,'height':900}).new_page()
        pg.on('console', lambda m: errs.append(m.text) if m.type=='error' else None)
        pg.on('pageerror', lambda e: errs.append(str(e)))
        return pg
    host=page(); guest=page()
    host.goto(f'{B}/{game}/'); host.wait_for_timeout(1500)
    host.get_by_role('textbox').first.fill('Rami')
    host.get_by_text(create_txt, exact=True).click(); host.wait_for_timeout(2500)
    print('HOST URL', host.url)
    code=re.search(r'/([A-HJKMNP-Z2-9]{5})', host.url).group(1)
    guest.goto(f'{B}/{game}/join/{code}'); guest.wait_for_timeout(2000)
    print('GUEST JOIN PAGE:', guest.inner_text('body')[:300].replace('\n',' | '))
    tb=guest.get_by_role('textbox')
    for i in range(tb.count()):
        if not tb.nth(i).input_value(): tb.nth(i).fill('Cece'); break
    btns=[b for b in guest.get_by_role('button').all_inner_texts()]
    print('GUEST BUTTONS', btns)
    guest.get_by_role('button', name=re.compile(r'^Join', re.I)).last.click(); guest.wait_for_timeout(3000)
    print('GUEST URL', guest.url)
    print('HOST NOW:', host.inner_text('body')[:400].replace('\n',' | '))
    host.screenshot(path=f'/tmp/e2e/{game}-host.png'); guest.screenshot(path=f'/tmp/e2e/{game}-guest.png')
    hb=[b for b in host.get_by_role('button').all_inner_texts()]
    print('HOST BUTTONS', hb)
    before=guest.inner_text('body')
    mover = host if 'Pass' in hb else guest
    if sys.argv[3:]:
        mover.get_by_role('button', name=sys.argv[3], exact=True).first.click(); mover.wait_for_timeout(2500)
        after_other=(guest if mover is host else host).inner_text('body')
        print('MOVE PROPAGATED:', before != after_other or mover is guest)
        print('OTHER NOW:', after_other[:300].replace('\n',' | '))
    print('ERRORS', errs[:6])
    br.close()
