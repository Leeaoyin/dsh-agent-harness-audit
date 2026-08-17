/**
 * User-facing message tables.
 *
 * Scope of translation, and why it is drawn here:
 *
 * - USER-facing text (command results, progress lines, report labels) follows
 *   the harness locale. That is the text a human reads.
 * - MODEL-facing text (subagent prompts, tool descriptions, rejection
 *   reasons) stays in English. The criteria are written in English, and
 *   instructions that disagree with the text they accompany produce worse
 *   compliance, not better. Subagents are instead told which language to
 *   WRITE their reported prose in, so report content matches the locale even
 *   though the instructions do not.
 * - The report's STRUCTURE — heading order, the per-finding shape — is never
 *   translated away; localising the labels keeps the document comparable
 *   across runs while letting the prose follow the reader.
 *
 * @module dsh-harness-audit/i18n
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: `settingsNamespace()` is a validating brand over a string, and
// importing it as a value would make `dsh-settings` a runtime dependency for
// one constant that is known-good at compile time.
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'

export type LanguageId = 'en' | 'zh'

/** Locale namespace owned by `@deepseek-ai/dsh-client-locale`. */
const LOCALE_NAMESPACE = 'locale' as SettingsNamespace

/** Map a BCP-47 tag onto a shipped language. */
function fromTag(tag: string | undefined): LanguageId | undefined {
  if (tag === undefined) return undefined
  return tag.toLowerCase().startsWith('zh') ? 'zh' : undefined
}

/**
 * Resolve the language for user-facing output, in this order:
 *
 * 1. An explicit `locale.preference` in Host settings. Authoritative when set.
 * 2. The host process locale.
 * 3. English.
 *
 * Step 2 exists because step 1 is usually EMPTY. The locale section is a Host
 * registration and readable here, but its `preference` is optional by design:
 * absence "delegates to the browser", and the browser's choice never reaches
 * the host — the client sends `clientTimeZone` over the wire, not a locale. A
 * user whose interface is Chinese purely because their browser is Chinese has
 * no stored preference at all, so reading settings alone answered "English"
 * for exactly the people who wanted Chinese.
 *
 * The host locale is a good proxy because `dsh web` normally runs on the same
 * machine as the browser. It is only a proxy: a remote deployment can differ,
 * which is what the explicit `language` config setting is for.
 */
export function resolveLanguage(ctx: Context, configured: 'auto' | LanguageId): LanguageId {
  if (configured !== 'auto') return configured

  const settings = ctx.get('settings')
  if (settings !== undefined) {
    try {
      const section = settings.get(LOCALE_NAMESPACE)
      const preference = (section as { preference?: unknown } | undefined)?.preference
      if (preference === 'zh' || preference === 'en') return preference
    } catch {
      // A settings backend failure must not decide the language; fall through.
    }
  }

  try {
    return fromTag(Intl.DateTimeFormat().resolvedOptions().locale) ?? 'en'
  } catch {
    return 'en'
  }
}

export interface Messages {
  // ---- command results ----
  alreadyRunning: string
  unknownChecks: (ids: string, known: string) => string
  noChecksSelected: string
  /** Refusal for input that carried text the parser could not interpret. */
  badInput: (raw: string) => string
  started: (id: string, count: number, dimensions: string, outputDir: string) => string
  failed: (detail: string) => string
  complete: (a: { findings: number; checks: number; skipped: string; rejections: number; input: number; output: number; md: string; json: string }) => string
  // ---- progress ----
  locating: (count: number, ids: string) => string
  reconDone: (landmarks: number, kinds: number, language: string) => string
  notCovered: (id: string, missing: string) => string
  checkRunning: (id: string, name: string) => string
  checkDone: (id: string, findings: number, rejected: number, input: number, output: number) => string
  checkFailed: (id: string, detail: string) => string
  // ---- report ----
  reportTitle: string
  target: string
  checksRunLine: (checks: number, confirmed: number, suspected: number) => string
  secSummary: string
  secConfirmed: string
  secSuspected: string
  secNotImplemented: string
  secNotCovered: string
  secCost: string
  secAppendix: string
  secLandmarks: string
  none: string
  notImplementedNote: string
  everythingEvaluated: string
  notCoveredWarning: string
  notCoveredTableHead: string
  whyMissingLandmarks: (kinds: string) => string
  whySubagentFailed: (detail: string) => string
  notSelected: (ids: string) => string
  consequence: string
  direction: string
  toConfirm: string
  costTotal: (usage: string, seconds: string) => string
  costTableHead: string
  stageRecon: string
  stageTotal: string
  rejectionNote: (count: number, detail: string) => string
  rejectionWarning: string
  /** Appendix line stating when the run happened, in local time. */
  ranAtLine: (local: string) => string
  languageLine: (language: string) => string
  subagentsLine: (provider: string, concurrency: number) => string
  scopeLine: (excluded: string | undefined) => string
  lspLine: (state: 'available' | 'unavailable' | 'not-probed') => string
  landmarkTableHead: string
  noLandmarks: string
  groupNotCovered: string
  groupNoFindings: (ran: number, total: number) => string
  groupVerdict: (verdict: string, count: number) => string
  verdictConfirmed: string
  verdictSuspected: string
  verdictNotImplemented: string
  modeANote: () => string
  /**
   * Output-language directive handed to every subagent, recon included. It
   * covers their own replies AND the prose fields they report.
   *
   * It must protect `evidence`: that field is compared against the file, so a
   * translated or reformatted excerpt is rejected by validation. Asking for
   * output in another language without that carve-out would turn every
   * finding into an `evidence-not-found` refusal.
   */
  outputLanguage: string
  /**
   * One-line job label. While a job runs this is the ONLY producer-supplied
   * text the jobs UI shows — `detail` is terminal-only — so it carries the
   * dimensions rather than repeating the kind, which the row already renders.
   */
  jobLabel: (ids: string, firstName: string, count: number) => string
  /** Terminal `detail`, replacing the generic status word on the finished row. */
  jobDetail: (findings: number, rejections: number, input: number, output: number) => string
  /** Body of the start notice steered into the conversation. */
  announce: (id: string, dimensions: string) => string
  /** Collapsed-row summary for that notice; capped at 120 chars by the seam. */
  announceSummary: (ids: string) => string
  // ---- dimension picker ----
  pickHeader: string
  pickQuestion: string
  pickDetail: string
  pickP1Suffix: string
  /** Shown when the human closes the dimension picker without choosing. */
  pickCancelled: string
  /**
   * One-line plain-language gloss per check id, shown as the picker option's
   * description. Check ids mean nothing to someone running this for the first
   * time; the observable FAILURE does.
   *
   * These paraphrase each check's `**Symptom.**` line and are navigation
   * copy, never criteria — no subagent is shown them, and `./criteria.ts`
   * remains the authority. A test asserts every check has one, so a check
   * added to the table cannot ship glossless.
   */
  checkGloss: Readonly<Record<string, string>>
}

const en: Messages = {
  alreadyRunning: 'an audit is already in progress',
  unknownChecks: (ids, known) => `unknown check id(s): ${ids}. Known: ${known}.`,
  noChecksSelected: 'no checks selected by the current configuration',
  badInput: (raw) => `could not understand "${raw}". Use "--checks C1" or "--checks C1,C9,C14", `
    + 'or pass nothing to run the configured set. Refusing rather than auditing a dimension you did not ask for.',
  started: (id, count, dimensions, outputDir) =>
    `Harness audit started as ${id}, running ${count} dimension(s) in subagents: ${dimensions}. `
    + 'Landmark reconnaissance runs first; a dimension whose required landmarks are absent is '
    + `reported as not covered rather than audited. Ask for its progress at any time (\`job_output ${id}\`); `
    + `reports land in ${outputDir}/ when it finishes.`,
  failed: (detail) => `harness audit failed: ${detail}`,
  complete: (a) => [
    `Audit complete: ${a.findings} finding(s) across ${a.checks} check(s).`,
    a.skipped.length > 0 ? `Not covered: ${a.skipped}.` : '',
    a.rejections > 0 ? `${a.rejections} submission(s) refused by evidence validation.` : '',
    `Cost: ${a.input} in / ${a.output} out.`,
    `Reports: ${a.md}, ${a.json}`,
  ].filter((l) => l.length > 0).join(' '),
  locating: (count, ids) => `locating landmarks (${count} check(s) queued: ${ids})`,
  reconDone: (landmarks, kinds, language) =>
    `recon done: ${landmarks} landmark(s) across ${kinds} kind(s), language ${language}`,
  notCovered: (id, missing) => `${id} not covered — required landmark(s) absent: ${missing}`,
  checkRunning: (id, name) => `${id} running (${name})`,
  checkDone: (id, findings, rejected, input, output) =>
    `${id} done — ${findings} finding(s), ${rejected} submission(s) refused, ${input}/${output} tokens`,
  checkFailed: (id, detail) => `${id} FAILED — ${detail}`,
  reportTitle: 'Harness robustness audit',
  target: 'Target',
  checksRunLine: (checks, confirmed, suspected) =>
    `Checks run: ${checks}    Findings: ${confirmed} confirmed / ${suspected} suspected`,
  secSummary: 'Summary',
  secConfirmed: 'Confirmed',
  secSuspected: 'Suspected',
  secNotImplemented: 'Not implemented',
  secNotCovered: 'Not covered',
  secCost: 'Cost',
  secAppendix: 'Appendix — run detail',
  secLandmarks: 'Landmarks',
  none: 'None.',
  notImplementedNote: 'These subsystems are absent. That is not a pass.',
  everythingEvaluated: 'Every check was evaluated.',
  notCoveredWarning: 'Nothing below was examined. Absence of findings for these means nothing was\nlooked at — not that nothing is wrong.',
  notCoveredTableHead: '| Check | Name | Why it could not be evaluated |',
  whyMissingLandmarks: (kinds) => `required landmark(s) not located: ${kinds}`,
  whySubagentFailed: (detail) => `subagent failed: ${detail}`,
  notSelected: (ids) => `Not selected for this run: ${ids}.`,
  consequence: 'Consequence',
  direction: 'Direction',
  toConfirm: 'To confirm, check',
  costTotal: (usage, seconds) => `Total: ${usage} over ${seconds}s.`,
  costTableHead: '| Stage | Status | Findings | Rejected | Tokens (in/out) |',
  stageRecon: '_recon_',
  stageTotal: '**total**',
  rejectionNote: (count, detail) => `> ${count} submitted finding(s) were refused by evidence validation (${detail}).`,
  rejectionWarning: '> A high rejection rate means the subagents are fabricating; fix the prompts, not the validation.',
  ranAtLine: (local) => `- Run at: ${local}`,
  languageLine: (language) => `- Primary language: ${language}`,
  subagentsLine: (provider, concurrency) => `- Subagents: ${provider}, concurrency ${concurrency}`,
  scopeLine: (excluded) => `- Scope: ${excluded === undefined
    ? 'everything in the workspace, including vendored dependencies'
    : `first-party code only (excluded: ${excluded})`}`,
  lspLine: (state) => `- LSP: ${state === 'not-probed' ? 'not probed' : state === 'available' ? 'available' : 'unavailable — text search only'}`,
  landmarkTableHead: '| Kind | Location | Symbol | Confidence |',
  noLandmarks: '_No landmarks were located._',
  groupNotCovered: 'not covered',
  groupNoFindings: (ran, total) => `no findings (${ran}/${total} checked)`,
  groupVerdict: (verdict, count) => `${verdict} (${count} finding${count === 1 ? '' : 's'})`,
  verdictConfirmed: 'confirmed',
  verdictSuspected: 'suspected',
  verdictNotImplemented: 'not-implemented',
  modeANote: () => 'This report covers the audit only. Turning these findings into a regression\n'
    + 'suite is a separate job and is not attempted here.',
  jobLabel: (ids, firstName, count) => (count === 1 ? `${ids} · ${firstName}` : `${ids} · ${count} dimensions`),
  jobDetail: (findings, rejections, input, output) =>
    `${findings} finding(s), ${rejections} refused, ${input}/${output} tokens`,
  announce: (id, dimensions) =>
    `A harness audit just started in the background as ${id}, running these dimensions in subagents: ${dimensions}. `
    + 'Acknowledge in one short sentence naming the dimensions. Do not start auditing anything yourself, '
    + 'do not read files, and do not call any tool — the audit runs on its own and will report when it finishes.',
  announceSummary: (ids) => `Harness audit started: ${ids}`,
  checkGloss: {
    C1: 'Whether every way tool execution can end — error, timeout, cancellation included — still records a result, and whether one failure in a parallel batch discards the rest.',
    C2: 'Whether anything edits a message after it was added, rather than only appending new ones.',
    C3: 'What a reader sees if the process dies between the two halves of a multi-part write, and whether that half-written state is detectable on restart.',
    C4: 'How model output is parsed: whether malformed arguments, a truncated stream, or a repeated call id are handled rather than trusted.',
    C5: 'Whether a model-supplied path is resolved and checked against the workspace root — after symlink resolution, not before.',
    C6: 'What environment a model-generated command inherits, and whether secrets are in it.',
    C7: 'Whether failures carry a closed set of error codes classified as retryable, not retryable, or fatal — or arrive as unclassified text.',
    C8: 'Whether independent outcomes collapse into a single status, so one failure hides or discards the successes beside it.',
    C9: 'What sits inside the retry wrapper: if the retried region performs a write, a command, or an outbound message, a retry repeats it.',
    C10: 'Whether the cancellation signal actually reaches outbound requests and spawned subprocesses, or stops at the loop.',
    C11: 'The timeout layers on one tool call and their relative sizes — the tool budget must expire before the resource underneath it.',
    C12: 'Whether hard ceilings exist on turns, tool calls, wall-clock time, tokens, and delegation depth.',
    C13: 'Whether context is managed at all as a session grows, and where truncation cuts — a cut through a call/result pair breaks the history.',
    C14: 'Whether everything before the newest message — system prompt, tool definitions, prior messages — is byte-identical between runs, which is what the cache needs.',
    C15: 'Whether the run leaves an event record covering turns, tool calls and results, retries, truncation, and approvals, complete enough to reconstruct it.',
  },
  pickHeader: "Audit scope",
  pickQuestion: "Which dimensions should this audit cover?",
  pickDetail: "Pick one to start — a single dimension is the cheapest way to see what the audit produces. Each one runs in its own subagent, so cost scales with the number selected. A dimension whose landmarks are absent from this codebase is reported as not covered rather than audited.",
  pickP1Suffix: " · critical",
  pickCancelled: "No dimensions selected — no audit started.",
  outputLanguage: [
  	"Output language: write your own replies in English, and write the `claim`, `consequence`,",
  	"`direction`, and `confirmHint` fields in English.",
  	"",
  	"Reproduce `evidence` EXACTLY as it appears in the file — never translate, reformat, or rewrite",
  	"a code excerpt. It is compared against the source, and a modified excerpt is refused. Keep file",
  	"paths, identifiers, landmark kinds, and check ids verbatim as well."
  ].join("\n")
}

const zh: Messages = {
  alreadyRunning: "已有一次审计正在进行中",
  unknownChecks: (ids, known) => `无法识别的检查项 id:${ids}。可用的检查项:${known}。`,
  noChecksSelected: "当前配置没有选中任何检查项",
  badInput: (raw) => `无法理解「${raw}」。请用 "--checks C1" 或 "--checks C1,C9,C14",不带参数则运行配置中的检查项。这里拒绝执行,而不是去审计一个你没有要求的维度。`,
  started: (id, count, dimensions, outputDir) => `审计已启动,任务 id 为 ${id},在子智能体中运行 ${count} 个评测维度:${dimensions}。先进行地标侦察;所需地标缺失的维度会被报告为"未覆盖"而不是被审计。随时可以查看进度(\`job_output ${id}\`);完成后报告写入 ${outputDir}/。`,
  failed: (detail) => `审计失败:${detail}`,
  complete: (a) => [
  	`审计完成:${a.checks} 个检查项共产出 ${a.findings} 条发现。`,
  	a.skipped.length > 0 ? `未覆盖:${a.skipped}。` : "",
  	a.rejections > 0 ? `${a.rejections} 条上报被证据校验拒收。` : "",
  	`成本:输入 ${a.input} / 输出 ${a.output}。`,
  	`报告:${a.md}、${a.json}`
  ].filter((l) => l.length > 0).join(" "),
  locating: (count, ids) => `正在定位地标(已排队 ${count} 个检查项:${ids})`,
  reconDone: (landmarks, kinds, language) => `侦察完成:${kinds} 类共 ${landmarks} 个地标,主语言 ${language}`,
  notCovered: (id, missing) => `${id} 未覆盖 —— 所需地标缺失:${missing}`,
  checkRunning: (id, name) => `${id} 运行中(${name})`,
  checkDone: (id, findings, rejected, input, output) => `${id} 完成 —— ${findings} 条发现,${rejected} 条上报被拒收,token ${input}/${output}`,
  checkFailed: (id, detail) => `${id} 失败 —— ${detail}`,
  reportTitle: "Harness 健壮性审计",
  target: "审计目标",
  checksRunLine: (checks, confirmed, suspected) => `已运行检查项:${checks}    发现:${confirmed} 条确认 / ${suspected} 条疑似`,
  secSummary: "总览",
  secConfirmed: "确认",
  secSuspected: "疑似",
  secNotImplemented: "未实现",
  secNotCovered: "未覆盖",
  secCost: "成本",
  secAppendix: "附录 —— 运行详情",
  secLandmarks: "地标",
  none: "无。",
  notImplementedNote: "以下子系统并不存在。这不等于通过。",
  everythingEvaluated: "所有检查项都已评估。",
  notCoveredWarning: "以下内容根本没有被检查。它们没有发现,只说明没有人看过 ——\n不代表没有问题。",
  notCoveredTableHead: "| 检查项 | 名称 | 未能评估的原因 |",
  whyMissingLandmarks: (kinds) => `未定位到所需地标:${kinds}`,
  whySubagentFailed: (detail) => `子智能体失败:${detail}`,
  notSelected: (ids) => `本次运行未选中:${ids}。`,
  consequence: "后果",
  direction: "修复方向",
  toConfirm: "人工需核实",
  costTotal: (usage, seconds) => `合计:${usage},耗时 ${seconds} 秒。`,
  costTableHead: "| 阶段 | 状态 | 发现 | 拒收 | token(输入/输出) |",
  stageRecon: "_侦察_",
  stageTotal: "**合计**",
  rejectionNote: (count, detail) => `> 有 ${count} 条上报被证据校验拒收(${detail})。`,
  rejectionWarning: "> 拒收率高说明子智能体在编造证据;该改的是提示词,不是校验。",
  ranAtLine: (local) => `- 运行时间:${local}`,
  languageLine: (language) => `- 项目主语言:${language}`,
  subagentsLine: (provider, concurrency) => `- 子智能体:${provider},并发 ${concurrency}`,
  scopeLine: (excluded) => `- 审计范围:${excluded === void 0 ? "工作区全部内容,包含依赖" : `仅第一方代码(已排除:${excluded})`}`,
  lspLine: (state) => `- LSP:${state === "not-probed" ? "未探测" : state === "available" ? "可用" : "不可用 —— 全程文本检索"}`,
  landmarkTableHead: "| 类型 | 位置 | 符号 | 置信度 |",
  noLandmarks: "_未定位到任何地标。_",
  groupNotCovered: "未覆盖",
  groupNoFindings: (ran, total) => `无发现(已检查 ${ran}/${total})`,
  groupVerdict: (verdict, count) => `${verdict}(${count} 条发现)`,
  verdictConfirmed: "确认",
  verdictSuspected: "疑似",
  verdictNotImplemented: "未实现",
  modeANote: () => '本报告只覆盖审计本身。把这些发现变成回归测试套件是另一件事,这里不做。',
  jobLabel: (ids, firstName, count) => count === 1 ? `${ids} · ${firstName}` : `${ids} · ${count} 个维度`,
  jobDetail: (findings, rejections, input, output) => `${findings} 条发现,${rejections} 条被拒收,token ${input}/${output}`,
  announce: (id, dimensions) => `一次 harness 审计刚刚在后台启动,任务 id 为 ${id},正在子智能体中运行这些维度:${dimensions}。请用一句话确认,并点出正在跑的维度。不要自己去审计任何东西,不要读取文件,也不要调用任何工具 —— 审计会自行运行,完成时会汇报。`,
  announceSummary: (ids) => `已启动 harness 审计:${ids}`,
  checkGloss: {
    C1: '查工具执行的每一种结束方式(正常返回、报错、超时、取消、提前返回、权限拒绝)是否都写回了结果,以及并行批次里一个失败会不会丢掉其余成功的结果。',
    C2: '查有没有代码在消息写入之后又去修改它,而不是只追加新消息。',
    C3: '查分成两段的写入过程中如果进程挂掉,重启时读到的是什么,以及这种半截状态能不能被识别出来。',
    C4: '查模型输出是怎么解析的:参数不合法、输出被截断、调用编号重复这些情况是被处理了,还是被当成可信输入。',
    C5: '查模型给出的路径有没有解析后再与工作区根目录比对,而且必须在符号链接解析之后比对。',
    C6: '查模型生成的命令继承了什么环境变量,里面有没有密钥。',
    C7: '查失败是否带有一组封闭的错误码,并被明确分类为可重试/不可重试/致命,还是只给出一段没有分类的文字。',
    C8: '查多个独立结果会不会被合并成一个状态,导致一个失败掩盖或丢弃旁边那些成功。',
    C9: '查重试包裹的范围里有什么:如果被重试的区间包含写入、执行命令或对外发消息,重试就会重复执行它。',
    C10: '查取消信号有没有真正传到对外请求和派生的子进程,还是只停在循环这一层。',
    C11: '查一次工具调用上有几层超时以及它们的大小关系 —— 工具预算必须早于底层资源超时。',
    C12: '查轮数、工具调用次数、运行时长、token、委派深度上有没有硬性上限。',
    C13: '查会话变长时有没有上下文管理,以及截断切在哪里 —— 切开配对的调用与结果会破坏历史。',
    C14: '查最新消息之前的所有内容(系统提示、工具定义、历史消息)在两次运行之间是否逐字节一致,这是缓存命中的前提。',
    C15: '查这次运行有没有留下覆盖轮次、工具调用与结果、重试、截断、审批的事件记录,且完整到足以重建。',
  },
  pickHeader: '审计范围',
  pickQuestion: '这次审计要覆盖哪些维度?',
  pickDetail: '建议先选一个 —— 单个维度是了解审计产出的最低成本方式。每个维度各起一个子智能体,'
    + '成本随选中数量线性增长。所需地标在本代码库中缺失的维度,会被报告为"未覆盖"而不是被审计。',
  pickP1Suffix: ' · 关键项',
  pickCancelled: '未选择任何维度,审计没有启动。',
  outputLanguage: [
    '输出语言:请用中文书写你自己的全部回复,以及 `claim`、`consequence`、`direction`、',
    '`confirmHint` 四个字段。',
    '',
    '`evidence` 必须与文件中的内容逐字一致 —— 绝不要翻译、重排或改写代码摘录。它会与源码比对,',
    '被改动过的摘录会被拒收。文件路径、标识符、地标类型、检查项 id 也一律保持原样。',
  ].join('\n'),
}

const TABLES: Record<LanguageId, Messages> = { en, zh }

export function messages(language: LanguageId): Messages {
  return TABLES[language]
}
