// Аудит ПРАВИЛ реального профілю (закривна хвиля W4): прогін повного дзеркала
// ValidateRule (model/ruleValidation.validateRule через спільний збирач входу
// model/stationView.buildRuleValidationInput) по кожному правилу теки ProcessingRules
// заданого профілю — без браузера, без запису на диск.
//
// НАВІЩО: закривна хвиля додала девʼять серверних перевірок, яких дзеркало не робило.
// Кожна з них могла б «почервонити» ЛЕГІТИМНЕ правило стенду, якби була перегином (а не
// дзеркалом) — цей інструмент показує ПОІМЕННО, що саме змінилось на реальному контенті:
// прогін на коді ДО фіксу і ПІСЛЯ дає два переліки, різниця між якими і є ціна хвилі.
//
// Використання:
//   npx tsx tests/tools/t4-8-rule-audit.ts <шлях-до-теки-профілю>
// Диск НЕ змінюється НІКОЛИ (жодного write), тека читається тим самим NodeFsBackend, що
// й writeback.ts.

import { loadProject } from '../../src/io/project'
import { loadClassIndex } from '../../src/model/classIndex'
import { buildChainGraph, asRuleLike } from '../../src/model/chainGraph'
import { buildRuleValidationInput } from '../../src/model/stationView'
import { validateRule } from '../../src/model/ruleValidation'
import { NodeFsBackend } from './nodeBackend'

async function main(): Promise<void> {
  const target = process.argv[2]
  if (!target) {
    console.error('Використання: npx tsx tests/tools/t4-8-rule-audit.ts <шлях-до-теки-профілю>')
    process.exitCode = 1
    return
  }

  const project = await loadProject(new NodeFsBackend(target))
  const index = loadClassIndex()
  const graph = buildChainGraph(project, index)

  let alarmRules = 0
  let warnRules = 0
  console.log(`Профіль: ${target}`)
  console.log(`Правил у графі: ${graph.nodes.length}`)
  for (const n of graph.nodes) {
    const rule = asRuleLike(n.rule)
    if (!rule) continue
    const errs = validateRule(buildRuleValidationInput(rule, n.rule as Record<string, unknown>), index)
    const alarms = errs.filter((e) => e.severity === 'alarm')
    const warns = errs.filter((e) => e.severity === 'warn')
    if (alarms.length > 0) alarmRules++
    if (warns.length > 0) warnRules++
    const mark = alarms.length > 0 ? 'АВАРІЯ' : warns.length > 0 ? 'увага' : 'чисто'
    console.log(`  [${mark}] ${n.filePath} :: ${n.ruleId}${n.disabled ? ' (вимкнене)' : ''}`)
    for (const e of alarms) console.log(`      ALARM ${e.path}: ${e.message}`)
    for (const e of warns) console.log(`      warn  ${e.path}: ${e.message}`)
  }
  console.log(`Разом: правил з alarm — ${alarmRules}, правил з warn — ${warnRules}`)
}

main().catch((e: unknown) => {
  console.error(e)
  process.exitCode = 1
})
