#!/usr/bin/env node
/**
 * Scores a dictation transcript for FIDELITY: did the app write what was said,
 * or what it decided was meant?
 *
 *   node score.mjs --takes <dir> [--json]        take-1.txt … take-6.txt from one app: the whole corpus
 *   node score.mjs <transcript-file> [--json]     one transcript of take 1 (the v1 twelve)
 *   node score.mjs --results <results.json> [--json]   every leg of a harness run
 *   node score.mjs --self-test                    the two controls, on the whole corpus
 *
 * This is deliberately not word error rate. WER counts a swap of "good" for
 * "well" as one substitution and cannot tell it apart from mishearing "good" as
 * "wood" — but to a person dictating those are completely different events. One
 * is the recogniser failing; the other is the product overruling them.
 *
 * Each item carries the forms that count as what was SPOKEN and the forms a
 * cleanup pass tends to produce. Four outcomes per item:
 *
 *   preserved  — a spoken form is present. The app wrote what was said.
 *   altered    — an altered form is present and no spoken form is.
 *   unclear    — neither matched, so this item says nothing. Usually the
 *                recogniser misheard the phrase entirely, which is a WER problem
 *                and is reported separately rather than scored as fidelity.
 *   unmeasured — the take produced no transcript at all (a failed call). Never
 *                a pass and never an edit: the run did not measure this item.
 *
 * `unclear` exists so the score cannot quietly improve when the transcript is
 * garbage. An app that returns nothing scores 0 preserved AND 0 altered, and the
 * denominator says so.
 *
 * The items live in fidelity-corpus.json, which the audio generator and the test
 * harness read too. `tier: "separate"` marks an item that cannot be read as an
 * edit even when it changes (a homophone, a disfluency, a name the recogniser
 * misspelled, a string that only arrives or does not), so it is reported on its
 * own line by kind and kept out of the headline score.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CORPUS = JSON.parse(readFileSync(join(HERE, 'fidelity-corpus.json'), 'utf8'));
export const ITEMS = CORPUS.items;
const V1_TAKE = 1;

/** Lower-case, collapse whitespace, normalise curly quotes. Punctuation is left
 *  alone: adding a comma is not editing the words. */
export function normalise(text) {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whole-phrase match. Substring matching let "the config" hit inside "that the config" and
 *  scored a mishearing as a tidy-up, so every phrase is anchored at both ends on a word boundary.
 *  Apostrophes count as part of a word; punctuation between words does not. */
export function contains(hay, phrase) {
  const escaped = normalise(phrase).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[^a-z0-9\']+');
  return new RegExp(`(^|[^a-z0-9'])${escaped}($|[^a-z0-9'])`).test(hay);
}

/** `transcript === null` is a take that returned nothing to score. */
export function outcomeFor(item, transcript) {
  if (transcript === null || transcript === undefined) return 'unmeasured';
  const hay = normalise(transcript);
  // A spoken form wins when both match: "the the config" contains "the config",
  // so a preserved stutter would otherwise read as altered.
  if (item.spoken.some((p) => contains(hay, p))) return 'preserved';
  if (item.altered.some((p) => contains(hay, p))) return 'altered';
  return 'unclear';
}

function tally(results) {
  const count = (o, set) => set.filter((r) => r.outcome === o).length;
  const headline = results.filter((r) => r.tier === 'headline');
  const decided = count('preserved', headline) + count('altered', headline);
  const byKind = {};
  for (const r of results.filter((x) => x.tier !== 'headline')) {
    byKind[r.kind] ??= { preserved: 0, altered: 0, unclear: 0, unmeasured: 0, n: 0 };
    byKind[r.kind][r.outcome] += 1;
    byKind[r.kind].n += 1;
  }
  return {
    n: headline.length,
    preserved: count('preserved', headline),
    altered: count('altered', headline),
    unclear: count('unclear', headline),
    unmeasured: count('unmeasured', results),
    // Every item, headline or not, whose words reached the page in either form. A sentence the
    // app dropped, or one the recogniser garbled, arrives as neither.
    arrived: count('preserved', results) + count('altered', results),
    total: results.length,
    decided,
    // Reported over DECIDED items, never over all of them — an app whose
    // recogniser garbled six phrases must not look more faithful for it.
    fidelity: decided ? count('preserved', headline) / decided : null,
    separate: byKind,
    items: results,
  };
}

/** One transcript against a set of items (default: take 1, so pre-v2 runs stay comparable). */
export function score(transcript, items = ITEMS.filter((i) => i.take === V1_TAKE)) {
  return tally(items.map((item) => ({ ...item, outcome: outcomeFor(item, transcript) })));
}

/** Each item against its own take's transcript. `textByTake[takeId]` is a string, or null if unmeasured. */
export function scoreTakes(textByTake, items = ITEMS) {
  return tally(items.map((item) => ({ ...item, outcome: outcomeFor(item, textByTake[item.take]) })));
}

/** Every leg and run of a harness results file. A leg that was not recorded stays unmeasured. */
export function scoreResults(results) {
  if (results.corpusVersion !== CORPUS.version) {
    throw new Error(`results are corpus v${results.corpusVersion}, the scorer has v${CORPUS.version}`);
  }
  return results.legs.map((leg) => {
    const { takes, ...meta } = leg;
    if (leg.status !== 'measured') return { ...meta, runs: [] };
    const runIds = [...new Set(takes.map((t) => t.run))].sort((a, b) => a - b);
    const runs = runIds.map((run) => {
      const textByTake = {};
      for (const take of CORPUS.takes) {
        const got = takes.find((t) => t.run === run && t.take === take.id);
        textByTake[take.id] = got && typeof got.text === 'string' ? got.text : null;
      }
      return { run, ...scoreTakes(textByTake) };
    });
    return { ...meta, runs };
  });
}

function controls() {
  const spoken = {}, tidied = {};
  for (const take of CORPUS.takes) {
    const own = ITEMS.filter((i) => i.take === take.id);
    spoken[take.id] = own.map((i) => i.spoken[0]).join('. ');
    tidied[take.id] = own.filter((i) => i.altered.length).map((i) => i.altered[0]).join('. ');
  }
  const asSpoken = scoreTakes(spoken), asTidied = scoreTakes(tidied);
  const failures = [];
  if (asSpoken.arrived !== asSpoken.total) failures.push(`as-spoken control: ${asSpoken.arrived}/${asSpoken.total} items arrived, want all`);
  if (asSpoken.fidelity !== 1 || asSpoken.preserved !== asSpoken.n) failures.push(`as-spoken control scored ${asSpoken.preserved}/${asSpoken.n}, want all preserved`);
  if (asTidied.fidelity !== 0 || asTidied.altered !== asTidied.n) failures.push(`tidied control scored ${asTidied.altered}/${asTidied.n} altered, want all altered`);
  const empty = scoreTakes({});
  if (empty.fidelity !== null || empty.unmeasured !== ITEMS.length) failures.push('a run with no transcripts must have no score and every item unmeasured');
  const ids = ITEMS.map((i) => i.id);
  if (new Set(ids).size !== ids.length) failures.push('duplicate item id');
  for (const i of ITEMS) {
    if (!CORPUS.takes.some((t) => t.id === i.take)) failures.push(`item ${i.id} names a take that does not exist`);
    if (i.tier === 'headline' && !i.altered.length) failures.push(`item ${i.id} is headline but has no altered form, so it could only ever raise the score`);
  }
  return { failures, headline: asSpoken.n, total: ITEMS.length };
}

const pct = (f) => (f === null ? 'NO SCORE' : `${(f * 100).toFixed(0)}%`);

function printTally(t, indent = '  ') {
  for (const r of t.items) {
    const mark = { preserved: 'kept   ', altered: 'CHANGED', unclear: '  ?    ', unmeasured: 'NOT RUN' }[r.outcome];
    const tag = r.tier === 'headline' ? '' : `   [${r.kind}, not in the headline]`;
    console.log(`${indent}${mark}  ${String(r.id).padStart(2)}  "${r.spoken[0]}"${tag}`);
  }
  console.log('');
  console.log(`${indent}preserved ${t.preserved}   changed ${t.altered}   not decided ${t.unclear}   of ${t.n} headline items`);
  if (t.unmeasured) console.log(`${indent}UNMEASURED: ${t.unmeasured} item(s) had no transcript. This run is not a pass.`);
  if (t.fidelity === null) {
    console.log(`${indent}NO SCORE — nothing in the transcript matched either form, so this run measured nothing.`);
  } else {
    console.log(`${indent}fidelity ${pct(t.fidelity)} of ${t.decided} decided headline items`);
  }
  console.log(`${indent}arrived ${t.arrived} of ${t.total} items, in either form`);
  for (const [kind, k] of Object.entries(t.separate)) {
    console.log(`${indent}(${kind}, not in the headline: kept ${k.preserved}, changed ${k.altered}, not decided ${k.unclear} of ${k.n})`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  if (args.includes('--self-test')) {
    const c = controls();
    if (c.failures.length) {
      for (const f of c.failures) console.error(`CONTROL FAILED: ${f}`);
      process.exit(1);
    }
    console.log(`controls hold: corpus v${CORPUS.version}, ${c.total} items, ${c.headline} in the headline`);
    process.exit(0);
  }
  const resultsAt = args.indexOf('--results');
  if (resultsAt !== -1) {
    const results = JSON.parse(readFileSync(args[resultsAt + 1], 'utf8'));
    const scored = scoreResults(results);
    if (json) {
      // No process.exit here: exiting with a large write still queued truncates a piped reader at 64 KB.
      console.log(JSON.stringify({ corpusVersion: CORPUS.version, runId: results.runId, build: results.build, legs: scored }, null, 2));
    } else {
    console.log(`corpus v${CORPUS.version} · build ${results.build} · run ${results.runId}`);
    for (const leg of scored) {
      console.log(`\n=== ${leg.path} · ${leg.mode} · ${leg.voice} voice ===`);
      if (leg.status !== 'measured') { console.log(`  UNMEASURED: ${leg.status}`); continue; }
      for (const run of leg.runs) {
        if (leg.runs.length > 1) console.log(`  run ${run.run}`);
        printTally(run);
      }
    }
    }
  } else if (args.includes('--takes')) {
    const dir = args[args.indexOf('--takes') + 1];
    const textByTake = {};
    for (const take of CORPUS.takes) {
      const path = join(dir, `take-${take.id}.txt`);
      textByTake[take.id] = existsSync(path) ? readFileSync(path, 'utf8') : null;
    }
    const result = scoreTakes(textByTake);
    if (json) console.log(JSON.stringify(result, null, 2));
    else printTally(result);
  } else {
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('usage: score.mjs --takes <dir> | <transcript-file> [--json] | --results <results.json> [--json] | --self-test');
    process.exit(1);
  }
  const result = score(readFileSync(file, 'utf8'));
  if (json) console.log(JSON.stringify(result, null, 2));
  else printTally(result);
}
  }
