import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Root-cause guard for the class of bug that made every primary button
// invisible: a stylesheet referenced `var(--primary-blue)`, a token from a
// retired set. An undefined custom property makes the whole declaration
// invalid at computed-value time, so `background` silently fell back to
// `transparent` while the sibling `color: white` survived.
//
// This is deliberately static rather than a browser check: it covers every
// property on every element in every stylesheet, including screens no test
// visits, and it names the exact file and line. The runtime counterpart in
// visibility.spec.js catches what survives this.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(__dirname, '../src')

// Files that define the design system. A token defined anywhere here is
// available globally, because these are imported before any page stylesheet.
const GLOBAL_TOKEN_FILES = ['index.css', 'App.css']

function cssFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return cssFiles(full)
    return entry.name.endsWith('.css') ? [full] : []
  })
}

function definedTokens(text) {
  return new Set([...text.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))
}

test.describe('css design tokens', () => {
  test('no stylesheet references a token that is not defined', () => {
    const files = cssFiles(SRC)
    expect(files.length, 'expected to find stylesheets under src/').toBeGreaterThan(0)

    const global = new Set()
    for (const name of GLOBAL_TOKEN_FILES) {
      const file = path.join(SRC, name)
      if (fs.existsSync(file)) {
        for (const t of definedTokens(fs.readFileSync(file, 'utf8'))) global.add(t)
      }
    }

    const offenders = []
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      const local = definedTokens(text)
      const lines = text.split('\n')

      lines.forEach((line, i) => {
        // var(--token) with NO fallback. `var(--x, #hex)` is safe by
        // construction, so it is deliberately not flagged.
        for (const m of line.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
          const token = m[1]
          if (!global.has(token) && !local.has(token)) {
            offenders.push({
              file: path.relative(SRC, file).replace(/\\/g, '/'),
              line: i + 1,
              token,
              source: line.trim()
            })
          }
        }
      })
    }

    expect(
      offenders,
      'Undefined CSS token(s) — the whole declaration is dropped at computed-value ' +
      'time, so the property silently falls back to its initial value ' +
      '(background -> transparent, border-color -> currentColor):\n' +
      JSON.stringify(offenders, null, 2)
    ).toEqual([])
  })

  test('no page stylesheet restyles a shared button or form class', () => {
    // Page CSS is global once its component is imported, and it loads after
    // index.css — so a rule for a shared class silently overrides the whole
    // app on source order. That is how one page's stale stylesheet took out
    // every primary button. Colour/fill belongs in index.css.
    const SHARED = [
      'btn', 'action-button', 'setup-button', 'cancel-button', 'submit-button',
      'save-button', 'back-button', 'logout-button', 'leave-button', 'danger-button',
      'edit-rules-button', 'invite-button', 'edit-button', 'add-button',
      'create-group-button', 'join-group-button', 'theme-action-button', 'view-round-button',
      // Shared form/layout classes too. One page's `.form-group textarea` rule
      // put a 2px 1.51:1 border on the Create Group wizard's field.
      'form-group', 'form-row', 'form-actions', 'form-hint', 'modal-content', 'modal-actions'
    ]
    // Properties that decide whether a control is visible at all.
    const VISUAL = /(^|[;{\s])(background|background-color|border|border-color|color)\s*:/

    const offenders = []
    for (const file of cssFiles(SRC)) {
      const rel = path.relative(SRC, file).replace(/\\/g, '/')
      if (GLOBAL_TOKEN_FILES.includes(path.basename(file))) continue

      const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      for (const block of text.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const selector = block[1]
        const body = block[2]
        // Only base rules matter: :hover/:focus tweaks on top of a sound
        // base are a normal, safe thing for a page to do.
        if (/:(hover|focus|active|disabled|focus-visible)/.test(selector)) continue
        if (!VISUAL.test(body)) continue

        // Only the leftmost compound matters. `.rules-edit-form .form-row label`
        // is scoped by a page-specific ancestor and cannot bleed; a bare
        // `.form-row` applies to every form in the app.
        const leftmost = selector.trim().split(/[\s>+~]+/)[0]
        for (const cls of SHARED) {
          const bare = new RegExp('\\.' + cls + '(?![\\w-])')
          if (bare.test(leftmost)) {
            offenders.push({ file: rel, selector: selector.trim().slice(0, 80), cls })
            break
          }
        }
      }
    }

    expect(
      offenders,
      'Page stylesheet(s) restyling a shared button or form class. These load after ' +
      'index.css and apply app-wide, so they override every page:\n' +
      JSON.stringify(offenders, null, 2)
    ).toEqual([])
  })
})
