import { expect } from '@playwright/test'

// Shared visual-accessibility audits, used by the site-wide sweep and by the
// modal sweep. Kept in one place so both ask exactly the same questions.
//
// axe's colour-contrast rule compares *text* to its own background, so it has
// nothing to say about a control with no fill at all — which is how a
// stylesheet written against a retired token set made every primary button in
// the app invisible while the suite stayed green. axe also never hovers, so a
// hover rule that repaints the background without re-asserting the text colour
// is invisible to it too. These two probes ask what axe cannot.
//
// Both probes are ordinary functions handed to Playwright's evaluate, never
// source strings: a probe built as a string has to survive two rounds of
// escaping, its regexes silently stop matching, and every contrast then reads
// exactly 1.00 — which looks like catastrophe rather than a broken probe.

/* ------------------------------------------------------------------ *
 * Resting state: is every interactive control perceivable at all?
 *
 * No allowlist. A control passes if IT OR ANY DESCENDANT contributes
 * something visible — fill, border, readable text, or media. That lets
 * legitimately chrome-less controls (text-only nav items, the modal ×, the
 * avatar button whose child span carries the colour) pass on their own
 * merits rather than by being named.
 * ------------------------------------------------------------------ */
export function auditRestingState() {
  const luminance = (color) => {
    const parts = (color.match(/[\d.]+/g) || []).slice(0, 3).map(Number)
    if (parts.length < 3) return null
    const [r, g, b] = parts.map((v) => {
      const c = v / 255
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const contrast = (a, b) => {
    const la = luminance(a); const lb = luminance(b)
    if (la === null || lb === null) return 1
    const [hi, lo] = la > lb ? [la, lb] : [lb, la]
    return (hi + 0.05) / (lo + 0.05)
  }
  const isTransparent = (c) => {
    if (!c || c === 'transparent') return true
    const p = c.match(/[\d.]+/g) || []
    return p.length === 4 && Number(p[3]) === 0
  }
  const backdropOf = (el) => {
    let node = el.parentElement
    while (node) {
      const bg = getComputedStyle(node).backgroundColor
      if (!isTransparent(bg)) return bg
      node = node.parentElement
    }
    return 'rgb(255, 255, 255)'
  }
  const rendered = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false
    const box = el.getBoundingClientRect()
    return box.width > 0 && box.height > 0
  }
  const contributes = (el, backdrop) => {
    const cs = getComputedStyle(el)
    if (!isTransparent(cs.backgroundColor) && contrast(cs.backgroundColor, backdrop) >= 1.1) return 'fill'
    if (parseFloat(cs.borderTopWidth) > 0 && !isTransparent(cs.borderTopColor)
        && contrast(cs.borderTopColor, backdrop) >= 3) return 'border'
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return 'background-image'
    const ownText = [...el.childNodes]
      .filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('')
    if (ownText && contrast(cs.color, backdrop) >= 3) return 'text'
    return null
  }

  const CONTROLS = 'button, a, input:not([type=hidden]), select, textarea, summary,'
    + ' [role=button], [role=radio], [role=checkbox], [role=tab], [role=link]'

  const offenders = []
  for (const el of document.querySelectorAll(CONTROLS)) {
    if (!rendered(el)) continue
    if (el.closest('[aria-hidden="true"]')) continue
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue
    // Native form controls are painted by the UA, not by our CSS.
    if (el.matches('input[type=checkbox], input[type=radio], input[type=range],'
      + ' input[type=color], input[type=file]')) continue

    const backdrop = backdropOf(el)
    let why = contributes(el, backdrop)
    if (!why) {
      for (const child of el.querySelectorAll('*')) {
        if (!rendered(child)) continue
        if (child.matches('img, svg, video, canvas')) { why = 'media child'; break }
        const childWhy = contributes(child, backdrop)
        if (childWhy) { why = childWhy + ' (child)'; break }
      }
    }
    if (!why) {
      const cs = getComputedStyle(el)
      offenders.push({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().slice(0, 40),
        className: typeof el.className === 'string' ? el.className : '',
        fill: cs.backgroundColor,
        color: cs.color,
        border: cs.borderTopWidth + ' ' + cs.borderTopColor,
        backdrop
      })
    }
  }
  return offenders
}

/* ------------------------------------------------------------------ *
 * Hover state: is the label still readable once :hover repaints things?
 *
 * Computed from the CSSOM rather than by moving the mouse. Hovering each
 * button in turn needed several round trips per control and blew the test
 * timeout on button-heavy pages; this resolves every button in one pass, so
 * it covers all of them instead of as many as fit in the budget.
 *
 * For each button it finds the :hover rules that match, applies them in
 * cascade order (specificity, then source order) over the resting computed
 * style, and checks the resulting text/background pair.
 * ------------------------------------------------------------------ */
export function auditHoverStates() {
  const luminance = (color) => {
    const parts = (color.match(/[\d.]+/g) || []).slice(0, 3).map(Number)
    if (parts.length < 3) return null
    const [r, g, b] = parts.map((v) => {
      const c = v / 255
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const contrast = (a, b) => {
    const la = luminance(a); const lb = luminance(b)
    if (la === null || lb === null) return null
    const [hi, lo] = la > lb ? [la, lb] : [lb, la]
    return (hi + 0.05) / (lo + 0.05)
  }
  const isTransparent = (c) => {
    if (!c || c === 'transparent') return true
    const p = c.match(/[\d.]+/g) || []
    return p.length === 4 && Number(p[3]) === 0
  }

  // a,b,c specificity: ids / classes+attrs+pseudo-classes / elements.
  const specificity = (sel) => {
    const ids = (sel.match(/#[\w-]+/g) || []).length
    const classes = (sel.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length
    const elements = (sel.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length
    return ids * 10000 + classes * 100 + elements
  }

  // Every rule in the document, hover and not, with specificity + order.
  //
  // Both are needed. An earlier version overlaid only the :hover rules on top
  // of the resting computed style, which is not how the cascade works: while
  // hovering, hover rules simply join the competition. `.tab-button:hover`
  // (0,2,0) does NOT beat a later `.tab-button.active` (0,2,0), so that
  // version reported the active tab as invisible when it is in fact white on
  // blue. Modelling the whole cascade gets both this and the real failures right.
  const allRules = []
  let order = 0
  for (const sheet of document.styleSheets) {
    let rules
    try { rules = sheet.cssRules } catch { continue }
    const walk = (list) => {
      for (const rule of list) {
        if (rule.media) {
          if (window.matchMedia(rule.conditionText || rule.media.mediaText).matches) walk(rule.cssRules)
          continue
        }
        if (!rule.selectorText) continue
        for (const single of rule.selectorText.split(',')) {
          allRules.push({
            selector: single.trim(),
            // Match against the selector with :hover removed — that is the
            // element set the rule applies to while hovered.
            base: single.replace(/:hover/g, '').trim(),
            isHover: single.indexOf(':hover') !== -1,
            spec: specificity(single),
            order: order++,
            style: rule.style
          })
        }
      }
    }
    walk(rules)
  }

  const offenders = []
  for (const el of document.querySelectorAll('button')) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue
    const box = el.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) continue
    if (el.disabled) continue
    const label = (el.textContent || '').trim()
    // Icon-only controls have no label to measure; the resting audit covers
    // whether they are perceivable at all.
    if (label.length < 2) continue

    const matching = allRules
      .filter((r) => { try { return el.matches(r.base) } catch { return false } })
    // Only worth checking if a hover rule actually applies to this element.
    if (!matching.some((r) => r.isHover)) continue

    // Cascade order: !important wins outright, then specificity, then source.
    const winner = (prop) => {
      let best = null
      for (const rule of matching) {
        const value = rule.style.getPropertyValue(prop)
        if (!value) continue
        const important = rule.style.getPropertyPriority(prop) === 'important' ? 1 : 0
        const rank = [important, rule.spec, rule.order]
        if (!best || rank[0] > best.rank[0]
            || (rank[0] === best.rank[0] && rank[1] > best.rank[1])
            || (rank[0] === best.rank[0] && rank[1] === best.rank[1] && rank[2] > best.rank[2])) {
          best = { value, rank }
        }
      }
      return best ? best.value : null
    }

    // Inline styles outrank every stylesheet rule.
    let color = el.style.color || winner('color') || cs.color
    let background = el.style.backgroundColor
      || winner('background-color') || winner('background') || cs.backgroundColor

    // var() references resolve against the element, so read them back.
    const resolve = (value) => {
      if (!value || value.indexOf('var(') === -1) return value
      const probe = document.createElement('span')
      probe.style.color = value
      el.appendChild(probe)
      const out = getComputedStyle(probe).color
      probe.remove()
      return out
    }
    color = resolve(color)
    background = resolve(background)

    let bg = background
    let node = el.parentElement
    while (isTransparent(bg) && node) { bg = getComputedStyle(node).backgroundColor; node = node.parentElement }
    if (isTransparent(bg)) bg = 'rgb(255, 255, 255)'

    // WCAG large text: >=24px, or >=18.66px when bold.
    const size = parseFloat(cs.fontSize)
    const weight = Number(cs.fontWeight) || 400
    const required = (size >= 24 || (size >= 18.66 && weight >= 700)) ? 3 : 4.5
    const ratio = contrast(color, bg)

    if (ratio !== null && ratio < required) {
      offenders.push({
        text: label.slice(0, 30),
        className: typeof el.className === 'string' ? el.className : '',
        hoverBackground: bg,
        hoverColor: color,
        ratio: Number(ratio.toFixed(2)),
        required
      })
    }
  }
  return offenders
}

export async function auditVisible(page, where) {
  const offenders = await page.evaluate(auditRestingState)
  expect(
    offenders,
    `Invisible element(s) on ${where} — present but nothing distinguishes them `
    + `from the backdrop (no fill, no border, no readable text, no media):\n`
    + JSON.stringify(offenders, null, 2)
  ).toEqual([])
}

export async function auditHover(page, where) {
  const offenders = await page.evaluate(auditHoverStates)
  expect(
    offenders,
    `Hover-state contrast failure(s) on ${where} — the label is unreadable `
    + `against the background the hover state paints:
${JSON.stringify(offenders, null, 2)}`
  ).toEqual([])
}

