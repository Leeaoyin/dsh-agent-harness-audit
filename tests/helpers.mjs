/** Minimal assertion harness — no framework, runs under plain `node`. */
export function suite(name) {
  const state = { name, pass: 0, fail: 0 }
  const t = (label, fn) => {
    try {
      fn()
      state.pass += 1
    } catch (error) {
      state.fail += 1
      console.log(`  FAIL ${label}\n       ${error.message.split('\n')[0]}`)
    }
  }
  return { t, state }
}

export function report(states) {
  const pass = states.reduce((n, s) => n + s.pass, 0)
  const fail = states.reduce((n, s) => n + s.fail, 0)
  for (const s of states) console.log(`${s.fail === 0 ? 'ok  ' : 'FAIL'} ${s.name}: ${s.pass} passed, ${s.fail} failed`)
  console.log(`\n${pass} passed, ${fail} failed`)
  return fail
}
