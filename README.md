# Dictation fidelity test

Does your dictation app write what you said, or what it thinks you meant?

Many dictation apps now pass your words through a language model before they reach the page. That model
often "fixes" things: *just as good* becomes *just as well*, *me and him went* becomes *he and I went*,
*we was running late* becomes *we were running late*. The recogniser heard you correctly; the product edited
you, silently.

Word error rate can't see this. Swapping *good* for *well* counts as one substitution, the same as mishearing
*good* as *wood*. This test measures the edit instead: 45 phrases a cleanup model is tempted to change, and a
scorer that reports which ones came back as spoken and which came back tidied.

Editing isn't always wrong. Plenty of people want the tidy version. The point is that you should be able to
tell, and choose.

## What's in it

| file | what it is |
|---|---|
| `fidelity-corpus.json` | 45 items in six takes. Each item has the spoken form and the forms a cleanup pass tends to produce. |
| `SCRIPT.md` | The six takes as plain text, to read aloud. |
| `audio/take-1.wav` … `take-6.wav` | The same takes synthesised with macOS's Samantha voice at 170 wpm (16 kHz mono), so runs are comparable. |
| `make-audio.sh` | Regenerates the clips with `say` and `afconvert`. |
| `score.mjs` | The scorer. Node 18 or later, no dependencies. |
| `results/` | Raw transcripts from runs we've done, scorable by anyone. |

**27 items are in the headline score.** Each has both a spoken and a tidied form, so a change can only be an
edit: grammar (*it don't matter*), register (*I seen it*, *y'all*, *wanna*), idioms (*I could care less*),
words a filter might drop (*this shit is broken*), numbers as spoken (*five hundred bucks*), and repetition for
emphasis (*no no no*).

**18 more are reported on their own lines**, because a change there isn't clearly an edit: homophones
(*should of* sounds like *should have*), fillers and stutters, technical strings (`npm test --watch`, a file
path), names from a personal dictionary, and spoken punctuation (*period*, *comma*).

## How to run it

1. Open any text field and turn on your dictation app with its default settings.
2. For each take, either read it aloud from `SCRIPT.md` or play `audio/take-<n>.wav` within reach of the
   microphone (or route it in with a loopback device).
3. Save what the app wrote for each take as `take-1.txt` … `take-6.txt` in one folder.
4. Score it:

```sh
node score.mjs --takes path/to/folder
```

You get one line per item (kept, changed, or not decided) and three numbers:

- **fidelity**: headline items kept, over headline items that came back in either form;
- **kept**: the count, so an item the recogniser garbled can't raise the score;
- **arrived**: of all 45, how many reached the page in either form. This catches a dropped sentence, which
  changes no word.

An item that came back as neither form is *not decided*: the recogniser misheard it, which is a word-error
problem, not an edit. `node score.mjs --self-test` checks the scorer against two controls (a verbatim
transcript scores 100%, a fully tidied one 0%).

## Results so far

| app | version | mode | fidelity | arrived | date |
|---|---|---|---|---|---|
| Halopen | 1.8.47 | Verbatim, streaming | 27 of 27 kept (100%) | 45 of 45 | 2026-10-16 |
| Halopen | 1.8.47 | Verbatim, batch | 27 of 27 kept (100%) | 45 of 45 | 2026-10-16 |

Synthetic voice (the clips in `audio/`), one run per mode. Raw transcripts are in `results/`.

**Disclosure:** this test was written by the team that makes [Halopen](https://halopen.com), a Mac
dictation app whose default is to write what you said. That is why we measure it, and it's also why you
shouldn't take our numbers on trust: the transcripts are here, and the test runs on any app.

**Add a result:** open a pull request with a folder under `results/` holding the six `take-<n>.txt`
files exactly as the app wrote them, plus the app name, version, mode and date. Results that favour no one in
particular are the most useful ones.

## Known limits

- Synthetic speech is cleaner than a person. A real voice will produce more *not decided* items.
- Item 9's doubled "the" is cut with a 300 ms pause; some recognisers still hear it as "that the".
- Spoken punctuation (*period*, *comma*) is reported, not judged: whether it should become a symbol is a
  product choice.

## License

MIT. See `LICENSE`.
